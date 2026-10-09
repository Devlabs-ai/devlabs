# GitHub Actions → AWS without stored keys. Each workflow job exchanges its OIDC token
# for one of these roles; the token's `sub` claim pins which jobs can assume which role:
#
#   build            push to main                    → push images to ECR, upload release bundle
#   deploy           job in environment "production" → run devlabs-deploy on the app instance
#   terraform-plan   pull request                    → read-only plan
#   terraform-apply  job in environment "infra"      → apply this stack
#
# Environments ("production", "infra") are where required reviewers and the main-only
# branch rule live (GitHub → Settings → Environments). Fork PRs never get an OIDC token.

locals {
  github_oidc_host = "token.actions.githubusercontent.com"
  sub              = var.github_oidc_subject_prefix

  github_role_subjects = {
    build           = ["${local.sub}:ref:refs/heads/main"]
    deploy          = ["${local.sub}:environment:production"]
    terraform-plan  = ["${local.sub}:pull_request"]
    terraform-apply = ["${local.sub}:environment:infra"]
  }

  state_bucket_arn = "arn:aws:s3:::devlabs-tfstate-${var.account_id}"
}

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://${local.github_oidc_host}"
  client_id_list = ["sts.amazonaws.com"]
}

data "aws_iam_policy_document" "github_trust" {
  for_each = local.github_role_subjects

  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.github_oidc_host}:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.github_oidc_host}:sub"
      values   = each.value
    }
  }
}

resource "aws_iam_role" "github" {
  for_each = local.github_role_subjects

  name                 = "devlabs-gha-${each.key}"
  assume_role_policy   = data.aws_iam_policy_document.github_trust[each.key].json
  max_session_duration = 3600
}

# --- build -----------------------------------------------------------------

data "aws_iam_policy_document" "gha_build" {
  statement {
    sid       = "EcrAuth"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "EcrPush"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:CompleteLayerUpload",
      "ecr:DescribeImages",
      "ecr:GetDownloadUrlForLayer",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
    ]
    resources = [for r in aws_ecr_repository.app : r.arn]
  }

  statement {
    sid       = "UploadReleaseBundles"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.releases.arn}/releases/*"]
  }
}

resource "aws_iam_role_policy" "gha_build" {
  name   = "devlabs-gha-build"
  role   = aws_iam_role.github["build"].id
  policy = data.aws_iam_policy_document.gha_build.json
}

# --- deploy ----------------------------------------------------------------

data "aws_iam_policy_document" "gha_deploy" {
  statement {
    sid     = "RunDeployDocumentOnAppInstance"
    actions = ["ssm:SendCommand"]
    resources = [
      aws_ssm_document.deploy.arn,
      "arn:aws:ec2:${var.region}:${var.account_id}:instance/${var.app_instance_id}",
    ]
  }

  statement {
    sid = "WatchCommand"
    actions = [
      "ssm:GetCommandInvocation",
      "ssm:ListCommandInvocations",
      "ssm:ListCommands",
    ]
    resources = ["*"]
  }

  statement {
    sid       = "CheckReleaseExists"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.releases.arn}/releases/*"]
  }

  statement {
    sid       = "CheckImagesExist"
    actions   = ["ecr:DescribeImages"]
    resources = [for r in aws_ecr_repository.app : r.arn]
  }
}

resource "aws_iam_role_policy" "gha_deploy" {
  name   = "devlabs-gha-deploy"
  role   = aws_iam_role.github["deploy"].id
  policy = data.aws_iam_policy_document.gha_deploy.json
}

# --- terraform plan (read-only) -------------------------------------------

resource "aws_iam_role_policy_attachment" "gha_terraform_plan_readonly" {
  role       = aws_iam_role.github["terraform-plan"].name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

data "aws_iam_policy_document" "gha_terraform_plan" {
  statement {
    sid       = "StateRead"
    actions   = ["s3:ListBucket"]
    resources = [local.state_bucket_arn]
  }

  statement {
    sid       = "StateLock"
    actions   = ["s3:PutObject", "s3:DeleteObject"]
    resources = ["${local.state_bucket_arn}/*.tflock"]
  }

  # ReadOnlyAccess can read data, not just configuration. PR plans run code from the
  # PR branch, so keep application data, secrets and private images out of reach.
  statement {
    sid           = "DenyDataOutsideState"
    effect        = "Deny"
    actions       = ["s3:GetObject*"]
    not_resources = ["${local.state_bucket_arn}/*"]
  }

  statement {
    sid    = "DenySecretsAndData"
    effect = "Deny"
    actions = [
      "secretsmanager:GetSecretValue",
      "ssm:GetParameter",
      "ssm:GetParameters",
      "ssm:GetParametersByPath",
      "kms:Decrypt",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
      "logs:GetLogEvents",
      "logs:FilterLogEvents",
      "logs:StartQuery",
      "dynamodb:GetItem",
      "dynamodb:BatchGetItem",
      "dynamodb:Query",
      "dynamodb:Scan",
      "eks:AccessKubernetesApi",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "gha_terraform_plan" {
  name   = "devlabs-gha-terraform-plan"
  role   = aws_iam_role.github["terraform-plan"].id
  policy = data.aws_iam_policy_document.gha_terraform_plan.json
}

# --- terraform apply -------------------------------------------------------
# Scoped to the resources this stack owns (devlabs-* names). It can still edit IAM
# roles it manages, including its own, so the "infra" environment's required reviewers
# and CODEOWNERS on infra/ are the real gate. Widen this when the stack grows.

data "aws_iam_policy_document" "gha_terraform_apply" {
  statement {
    sid       = "StateBucketList"
    actions   = ["s3:ListBucket"]
    resources = [local.state_bucket_arn]
  }

  statement {
    sid       = "StateObjects"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${local.state_bucket_arn}/*"]
  }

  statement {
    sid = "IamRead"
    actions = [
      "iam:Get*",
      "iam:List*",
    ]
    resources = ["*"]
  }

  statement {
    sid     = "IamOwned"
    actions = ["iam:*"]
    resources = [
      "arn:aws:iam::${var.account_id}:role/devlabs-*",
      "arn:aws:iam::${var.account_id}:policy/devlabs-*",
      "arn:aws:iam::${var.account_id}:instance-profile/devlabs-*",
      "arn:aws:iam::${var.account_id}:oidc-provider/${local.github_oidc_host}",
    ]
  }

  statement {
    sid       = "OnlyApprovedManagedPolicies"
    effect    = "Deny"
    actions   = ["iam:AttachRolePolicy"]
    resources = ["*"]

    condition {
      test     = "ArnNotLike"
      variable = "iam:PolicyARN"
      values = [
        "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
        "arn:aws:iam::aws:policy/ReadOnlyAccess",
        "arn:aws:iam::${var.account_id}:policy/devlabs-*",
      ]
    }
  }

  statement {
    sid     = "EcrOwned"
    actions = ["ecr:*"]
    resources = [
      "arn:aws:ecr:${var.region}:${var.account_id}:repository/devlabs/*",
    ]
  }

  statement {
    sid = "EcrAccountLevel"
    actions = [
      "ecr:DescribeRepositories",
      "ecr:GetAuthorizationToken",
      "ecr:DescribeRegistry",
      "ecr:GetRegistryPolicy",
    ]
    resources = ["*"]
  }

  statement {
    sid     = "ReleasesBucket"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.releases.arn,
      "${aws_s3_bucket.releases.arn}/*",
    ]
  }

  statement {
    sid       = "SsmDocuments"
    actions   = ["ssm:*"]
    resources = ["arn:aws:ssm:${var.region}:${var.account_id}:document/devlabs-*"]
  }

  statement {
    sid       = "SsmList"
    actions   = ["ssm:ListDocuments"]
    resources = ["*"]
  }

  statement {
    sid       = "LogGroups"
    actions   = ["logs:*"]
    resources = ["arn:aws:logs:${var.region}:${var.account_id}:log-group:/devlabs/*"]
  }

  statement {
    sid       = "LogGroupsList"
    actions   = ["logs:DescribeLogGroups"]
    resources = ["*"]
  }
}

resource "aws_iam_policy" "gha_terraform_apply" {
  name   = "devlabs-gha-terraform-apply"
  policy = data.aws_iam_policy_document.gha_terraform_apply.json
}

resource "aws_iam_role_policy_attachment" "gha_terraform_apply" {
  role       = aws_iam_role.github["terraform-apply"].name
  policy_arn = aws_iam_policy.gha_terraform_apply.arn
}
