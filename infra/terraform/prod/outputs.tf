output "github_role_arns" {
  value = { for k, r in aws_iam_role.github : k => r.arn }
}

output "ecr_registry" {
  value = local.ecr_registry
}

output "ecr_repositories" {
  value = { for k, r in aws_ecr_repository.app : k => r.repository_url }
}

output "release_bucket" {
  value = aws_s3_bucket.releases.bucket
}

output "deploy_document" {
  value = aws_ssm_document.deploy.name
}

output "deploy_log_group" {
  value = aws_cloudwatch_log_group.deploy.name
}

output "app_instance_profile" {
  value = aws_iam_instance_profile.app_instance.name
}
