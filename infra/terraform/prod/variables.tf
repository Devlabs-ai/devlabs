variable "account_id" {
  type        = string
  description = "AWS account every resource lives in; the provider refuses to run against any other."
}

variable "region" {
  type    = string
  default = "ap-south-2"
}

variable "github_repository" {
  type        = string
  description = "owner/name of the repo whose workflows may assume the CI roles. Case-sensitive."
}

variable "app_instance_id" {
  type        = string
  description = "EC2 instance running docker-compose.prod.yml; the only SSM deploy target."
}

variable "app_dir" {
  type        = string
  default     = "/opt/devlabs"
  description = "Directory on the app instance that holds .env, kube/ and the compose project."
}

variable "ecr_repositories" {
  type        = list(string)
  default     = ["devlabs/backend", "devlabs/lab-shell"]
  description = "Private images built by CI and pulled by the app instance."
}

variable "ecr_keep_images" {
  type        = number
  default     = 30
  description = "Images kept per repo; older ones expire, so rollbacks reach back this many builds."
}

variable "release_retention_days" {
  type    = number
  default = 90
}
