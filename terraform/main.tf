terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# -----------------------------------------------------------------
# PROVIDER CONFIGURATION
# -----------------------------------------------------------------
provider "aws" {
  region = "us-east-1"

  # For AWS Academy Lab environment
  access_key = var.aws_access_key
  secret_key = var.aws_secret_key
  token      = var.aws_session_token
}

data "aws_region" "current" {}

# -----------------------------------------------------------------
# NETWORKING (VPC, SUBNETS, ROUTING)
# -----------------------------------------------------------------

# (ส่วน VPC, Subnets, IGW, NAT, Route Tables... ไม่เปลี่ยนแปลง)
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags = {
    Name = "talkit-vpc"
  }
}
resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags = {
    Name = "talkit-igw"
  }
}
resource "aws_subnet" "public_1" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = "us-east-1a"
  map_public_ip_on_launch = true
  tags = {
    Name = "talkit-public-1"
  }
}
resource "aws_subnet" "public_2" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.2.0/24"
  availability_zone       = "us-east-1b"
  map_public_ip_on_launch = true
  tags = {
    Name = "talkit-public-2"
  }
}
resource "aws_subnet" "private_1" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.3.0/24"
  availability_zone       = "us-east-1a"
  map_public_ip_on_launch = false
  tags = {
    Name = "talkit-private-1"
  }
}
resource "aws_subnet" "private_2" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.4.0/24"
  availability_zone       = "us-east-1b"
  map_public_ip_on_launch = false
  tags = {
    Name = "talkit-private-2"
  }
}
resource "aws_eip" "nat" {
  domain = "vpc"
}
resource "aws_nat_gateway" "main" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public_1.id
  tags = {
    Name = "talkit-nat-gw"
  }
  depends_on = [aws_internet_gateway.main]
}
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  tags = {
    Name = "talkit-public-rt"
  }
}
resource "aws_route_table_association" "public_1" {
  subnet_id      = aws_subnet.public_1.id
  route_table_id = aws_route_table.public.id
}
resource "aws_route_table_association" "public_2" {
  subnet_id      = aws_subnet.public_2.id
  route_table_id = aws_route_table.public.id
}
resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main.id
  }
  tags = {
    Name = "talkit-private-rt"
  }
}
resource "aws_route_table_association" "private_1" {
  subnet_id      = aws_subnet.private_1.id
  route_table_id = aws_route_table.private.id
}
resource "aws_route_table_association" "private_2" {
  subnet_id      = aws_subnet.private_2.id
  route_table_id = aws_route_table.private.id
}

# -----------------------------------------------------------------
# SECURITY GROUPS (ไม่เปลี่ยนแปลง)
# -----------------------------------------------------------------

resource "aws_security_group" "alb" {
  name        = "talkit-alb-sg"
  description = "Allow HTTP inbound traffic"
  vpc_id      = aws_vpc.main.id
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = {
    Name = "talkit-alb-sg"
  }
}

resource "aws_security_group" "ec2" {
  name        = "talkit-ec2-sg"
  description = "Allow traffic from ALB, SSH, and internal services"
  vpc_id      = aws_vpc.main.id

  # Ingress for Node.js App (Port 8080 from ALB)
  ingress {
    from_port       = 8080
    to_port         = 8080
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  # Ingress for Python Service (Port 8000 internal)
  ingress {
    from_port       = 8000
    to_port         = 8000
    protocol        = "tcp"
    self            = true
  }

  # Ingress for SSH (Port 22 from your IP)
  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.my_ip] # (ถ้า Debug ให้ใช้ "0.0.0.0/0" ชั่วคราว)
  }

  # Ingress for Ping (ICMP)
  ingress {
    from_port   = -1
    to_port     = -1
    protocol    = "icmp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "talkit-ec2-sg"
  }
}

resource "aws_security_group" "rds" {
  name        = "talkit-rds-sg"
  description = "Security group for RDS PostgreSQL"
  vpc_id      = aws_vpc.main.id
  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ec2.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = {
    Name = "talkit-rds-sg"
  }
}

# -----------------------------------------------------------------
# APPLICATION LOAD BALANCER (ALB)
# -----------------------------------------------------------------

resource "aws_lb" "main" {
  name               = "talkit-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = [aws_subnet.public_1.id, aws_subnet.public_2.id]
  tags = {
    Name = "talkit-alb"
  }
}

resource "aws_lb_target_group" "main" {
  name     = "talkit-tg"
  port     = 8080 # Point to Node.js port 8080
  protocol = "HTTP"
  vpc_id   = aws_vpc.main.id
  health_check {
    path = "/"
  }
  stickiness {
    type            = "lb_cookie" # Use Load Balancer generated cookie
    cookie_duration = 3600        # Stickiness duration in seconds (1 hour)
    enabled         = true
  }
  tags = {
    Name = "talkit-tg"
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.main.arn
  }
}

# -----------------------------------------------------------------
# EC2 INSTANCE
# -----------------------------------------------------------------

# --- Single EC2 Instance ---
resource "aws_instance" "main" {
  # Use your Golden AMI ID
  ami           = "ami-093506617ced6604a"

  instance_type = "t3.medium"

  # (ตั้งค่าสำหรับ Debug - Public Subnet + Public IP)
  subnet_id                   = aws_subnet.public_1.id
  associate_public_ip_address = true

  vpc_security_group_ids = [aws_security_group.ec2.id]
  key_name               = var.ec2_key_name

  # The user_data script is now *much* smaller
  user_data = base64encode(templatefile("user_data.sh.tpl", {
    db_user                = var.db_username
    db_pass                = var.db_password
    db_host                = aws_db_instance.talkit_db.endpoint
    db_port                = aws_db_instance.talkit_db.port
    db_name                = aws_db_instance.talkit_db.db_name
    aws_region             = data.aws_region.current.name
    cognito_client_id      = aws_cognito_user_pool_client.client.id # Fixed reference
    cognito_user_pool_id   = aws_cognito_user_pool.main.id
    aws_s3_bucket          = aws_s3_bucket.profile_uploads.bucket
    cognito_jwks_url       = "https://cognito-idp.${data.aws_region.current.name}.amazonaws.com/${aws_cognito_user_pool.main.id}/.well-known/jwks.json"
    aws_access_key    = var.aws_access_key
    aws_secret_key    = var.aws_secret_key
    aws_session_token = var.aws_session_token
  }))

  tags = {
    Name = "talkit-ec2-instance"
  }
}

# --- Attach Instance to Load Balancer ---
resource "aws_lb_target_group_attachment" "main" {
  target_group_arn = aws_lb_target_group.main.arn
  target_id        = aws_instance.main.id
  port             = 8080 # Point to Node.js port 8080
}

# -----------------------------------------------------------------
# RDS DATABASE (SECURED)
# -----------------------------------------------------------------

resource "aws_db_subnet_group" "default" {
  name       = "talkit-subnet-group"
  subnet_ids = [aws_subnet.private_1.id, aws_subnet.private_2.id]
  tags = {
    Name = "Talkit DB subnet group"
  }
}

resource "aws_db_instance" "talkit_db" {
  identifier           = "talkit-database-v2"

  engine               = "postgres"
  engine_version       = "15"
  instance_class       = "db.t3.medium"
  allocated_storage    = 20
  storage_type         = "gp2"
  db_name              = "postgres"
  username             = var.db_username
  password             = var.db_password

  vpc_security_group_ids = [aws_security_group.rds.id]
  db_subnet_group_name   = aws_db_subnet_group.default.name

  multi_az            = false
  publicly_accessible = false
  skip_final_snapshot = true

  backup_retention_period = 1
  backup_window           = "03:00-04:00"
  maintenance_window      = "Mon:04:00-Mon:05:00"

  tags = {
    Name = "talkit-database"
  }
}

# -----------------------------------------------------------------
# COGNITO (แก้ไข)
# -----------------------------------------------------------------

resource "aws_cognito_user_pool" "main" {
  name = "talkit-user-pool"

  password_policy {
    minimum_length    = 8
    require_lowercase = true
    require_numbers   = true
    require_symbols   = true
    require_uppercase = true
  }

  # REMOVED: username_attributes = ["username"] (Invalid & Defaults to username anyway)

  auto_verified_attributes = ["email"]
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  # REMOVED: Explicit custom 'email' schema block (managed by Cognito)

  # Keep the 'name' attribute
  schema {
    attribute_data_type = "String"
    name                = "name"
    mutable             = true
    string_attribute_constraints {
      min_length = 1
      max_length = 256
    }
  }

  # Added standard email attribute definition
  schema {
    attribute_data_type      = "String"
    developer_only_attribute = false
    mutable                  = true
    name                     = "email"
    required                 = true # Still require email for verification/recovery
    string_attribute_constraints {
      min_length = 7
      max_length = 256
    }
  }
}

# --- V V V V V ADDED THIS BLOCK V V V V V ---
# Add the missing User Pool Client resource
resource "aws_cognito_user_pool_client" "client" {
  name = "talkit-client" # This name matches the output.tf reference

  user_pool_id = aws_cognito_user_pool.main.id

  # Common settings, adjust if needed
  explicit_auth_flows = [
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH"
  ]
  prevent_user_existence_errors = "ENABLED"
  access_token_validity         = 1     # e.g., 1 hour
  refresh_token_validity        = 30    # e.g., 30 days
  id_token_validity             = 1     # e.g., 1 hour

  token_validity_units {
    access_token  = "hours" # Or days
    refresh_token = "days"
    id_token      = "hours" # Or days
  }
}
# --- ^ ^ ^ ^ ^ ADDED THIS BLOCK ^ ^ ^ ^ ^ ---


# -----------------------------------------------------------------
# S3 BUCKET
# -----------------------------------------------------------------

resource "random_id" "suffix" {
  byte_length = 4
}

resource "aws_s3_bucket" "profile_uploads" {
  bucket = "talkit-bucket-${random_id.suffix.hex}"

  tags = {
    Name = "talkit-profile-uploads"
  }
}

resource "aws_s3_bucket_ownership_controls" "profile_uploads" {
  bucket = aws_s3_bucket.profile_uploads.id
  rule {
    object_ownership = "BucketOwnerPreferred"
  }
}

resource "aws_s3_bucket_acl" "profile_uploads" {
  depends_on = [aws_s3_bucket_ownership_controls.profile_uploads]
  bucket     = aws_s3_bucket.profile_uploads.id
  acl        = "public-read"
}

resource "aws_s3_bucket_public_access_block" "profile_uploads" {
  bucket = aws_s3_bucket.profile_uploads.id
  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}

resource "aws_s3_bucket_policy" "profile_uploads_public_read" {
  bucket = aws_s3_bucket.profile_uploads.id
  policy = jsonencode({
    Statement = [
      {
        Effect    = "Allow"
        Principal = "*"
        Action    = ["s3:GetObject"]
        Resource  = ["${aws_s3_bucket.profile_uploads.arn}/*"]
      }
    ]
  })

  depends_on = [aws_s3_bucket_public_access_block.profile_uploads]
}

resource "aws_s3_bucket_cors_configuration" "profile_uploads_cors" {
  bucket = aws_s3_bucket.profile_uploads.id
  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT", "POST", "DELETE", "HEAD"]
    allowed_origins = [
      "*"
    ]
    expose_headers = [
      "ETag",
      "x-amz-server-side-encryption",
      "x-amz-request-id",
      "x-amz-id-2"
    ]
    max_age_seconds = 3600
  }
}
