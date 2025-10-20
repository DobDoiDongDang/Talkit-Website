output "alb_dns_name" {
  description = "The DNS name of the Application Load Balancer"
  value       = aws_lb.main.dns_name
}

output "efs_id" {
  description = "The ID of the EFS file system"
  value       = aws_efs_file_system.main.id
}

output "rds_endpoint" {
  description = "The connection endpoint for the RDS instance"
  value       = aws_db_instance.talkit_db.endpoint
  sensitive   = true
}

output "rds_port" {
  description = "The port the RDS instance is listening on"
  value       = aws_db_instance.talkit_db.port
}

output "db_name" {
  description = "The name of the database"
  value       = aws_db_instance.talkit_db.db_name
}

output "cognito_user_pool_id" {
  description = "The ID of the Cognito User Pool"
  value       = aws_cognito_user_pool.main.id
}

output "cognito_client_id" {
  description = "The ID of the Cognito User Pool Client"
  value       = aws_cognito_user_pool_client.client.id
}

output "cognito_endpoint" {
  description = "The endpoint of the Cognito User Pool"
  value       = aws_cognito_user_pool.main.endpoint
}

output "s3_profile_uploads_bucket" {
  description = "The name of the S3 bucket for profile uploads"
  value       = aws_s3_bucket.profile_uploads.bucket
}

output "s3_profile_uploads_arn" {
  description = "The ARN of the S3 bucket for profile uploads"
  value       = aws_s3_bucket.profile_uploads.arn
}