variable "db_username" {
  description = "Database administrator username"
  type        = string
  sensitive   = true
}

variable "db_password" {
  description = "Database administrator password"
  type        = string
  sensitive   = true
}

variable "environment" {
  description = "Environment (dev/prod)"
  type        = string
  default     = "dev"
}

variable "my_ip" {
  description = "Your local IP address for SSH access (e.g., '1.2.3.4/32')."
  type        = string
  default     = "0.0.0.0/0" # WARNING: Change this
}

variable "ec2_key_name" {
  description = "The name of your EC2 Key Pair for SSH access"
  type        = string
  default     = "" # Make sure to set this in your tfvars
}

variable "aws_access_key" {
  description = "AWS Access Key ID (for Lab environment)"
  type        = string
  default     = ""
  sensitive   = true
}

variable "aws_secret_key" {
  description = "AWS Secret Access Key (for Lab environment)"
  type        = string
  default     = ""
  sensitive   = true
}

variable "aws_session_token" {
  description = "AWS Session Token (for Lab environment)"
  type        = string
  default     = ""
  sensitive   = true
}