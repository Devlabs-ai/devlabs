terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  backend "s3" {
    bucket       = "devlabs-tfstate-204098850303"
    key          = "prod/terraform.tfstate"
    region       = "ap-south-2"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region              = var.region
  allowed_account_ids = [var.account_id]

  default_tags {
    tags = {
      Project   = "devlabs"
      ManagedBy = "terraform"
      Stack     = "prod"
    }
  }
}
