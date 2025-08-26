resource "aws_ecr_repository" "app_repo" {
  name                 = "existential-calculator-repo"
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration {
    scan_on_push = true
  }
  lifecycle {
    ignore_changes = [tags, tags_all]
  }
  force_delete = true
}

output "repository_url" {
  value = aws_ecr_repository.app_repo.repository_url
}
