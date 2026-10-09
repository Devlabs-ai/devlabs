# Identity of the app EC2 host and the only command CI may run on it.
#
# The role lets the host talk to SSM, pull images from ECR, read release bundles and
# write deploy logs. It deliberately has no access to devlabs-data or EKS yet: the
# backend container still uses its own credentials from .env. Keep the instance's
# IMDS hop limit at 1 so containers on the host cannot reach these credentials.

resource "aws_iam_role" "app_instance" {
  name = "devlabs-app-instance"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "app_instance_ssm" {
  role       = aws_iam_role.app_instance.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "app_instance" {
  statement {
    sid       = "EcrAuth"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "EcrPull"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
    ]
    resources = [for r in aws_ecr_repository.app : r.arn]
  }

  statement {
    sid       = "ReadReleaseBundles"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.releases.arn}/releases/*"]
  }

  statement {
    sid       = "DeployLogsDescribe"
    actions   = ["logs:DescribeLogGroups"]
    resources = ["*"]
  }

  statement {
    sid = "DeployLogsWrite"
    actions = [
      "logs:CreateLogStream",
      "logs:DescribeLogStreams",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.deploy.arn}:*"]
  }
}

resource "aws_iam_role_policy" "app_instance" {
  name   = "devlabs-app-instance"
  role   = aws_iam_role.app_instance.id
  policy = data.aws_iam_policy_document.app_instance.json
}

resource "aws_iam_instance_profile" "app_instance" {
  name = "devlabs-app-instance"
  role = aws_iam_role.app_instance.name
}

resource "aws_ssm_document" "deploy" {
  name            = "devlabs-deploy"
  document_type   = "Command"
  document_format = "JSON"

  content = jsonencode({
    schemaVersion = "2.2"
    description   = "Deploy one DevSetu release (commit SHA) to the app host."
    parameters = {
      ReleaseSha = {
        type           = "String"
        description    = "Full 40-char commit SHA built by CI."
        allowedPattern = "^[0-9a-f]{40}$"
      }
    }
    mainSteps = [{
      action = "aws:runShellScript"
      name   = "deploy"
      inputs = {
        timeoutSeconds = "900"
        runCommand = [
          "set -euo pipefail",
          "sha='{{ ReleaseSha }}'",
          "work=\"$(mktemp -d /tmp/devlabs-release.XXXXXX)\"",
          "trap 'rm -rf \"$work\"' EXIT",
          "aws s3 cp --only-show-errors --region ${var.region} \"s3://${aws_s3_bucket.releases.bucket}/releases/$sha.tar.gz\" \"$work/release.tar.gz\"",
          "tar -xzf \"$work/release.tar.gz\" -C \"$work\"",
          "APP_DIR='${var.app_dir}' RELEASE_SHA=\"$sha\" ECR_REGISTRY='${local.ecr_registry}' AWS_REGION='${var.region}' bash \"$work/scripts/deploy-release.sh\"",
        ]
      }
    }]
  })
}
