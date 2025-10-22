#!/bin/bash
set -euo pipefail # Stop on error

# -----------------------------------------------------------------
# 1. INSTALL ALL DEPENDENCIES
# -----------------------------------------------------------------
yum update -y
yum install -y git

# Install Node.js 18
curl -sL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo yum install -y nodejs

# Install PM2 (Process Manager for Node.js) globally
npm install -g pm2

# Install Docker and Docker Compose Plugin
amazon-linux-extras install docker -y
systemctl start docker
systemctl enable docker
yum install -y docker-compose-plugin

# -----------------------------------------------------------------
# 2. CLONE APP REPOSITORY
# -----------------------------------------------------------------
APP_DIR="/var/www/talkit-app"
mkdir -p $APP_DIR
git clone https://github.com/DobDoiDongDang/Talkit-Website.git $APP_DIR

# -----------------------------------------------------------------
# 3. SETUP AND RUN THE NODE.JS APPLICATION
# -----------------------------------------------------------------
echo "--- Setting up Node.js application ---"

# Download RDS SSL Certificate
echo "Downloading RDS SSL certificate..."
mkdir -p $APP_DIR/certs
curl -o $APP_DIR/certs/global-bundle.pem https://s3.amazonaws.com/rds-downloads/global-bundle.pem

# Create the .env file for the Node.js app
echo "Creating .env file..."
cat <<EOF > $APP_DIR/.env
DATABASE_URL=postgresql://${db_user}:${db_pass}@${db_host}:${db_port}/${db_name}?sslmode=require&rejectUnauthorized=false&sslrootcert=./certs/global-bundle.pem
AWS_REGION=${aws_region}
AWS_S3_BUCKET=${aws_s3_bucket}
COGNITO_CLIENT_ID=${cognito_client_id}
COGNITO_USER_POOL_ID=${cognito_user_pool_id}
COGNITO_JWT_PUBLIC_KEY=${cognito_jwks_url}
PORT=8080
AWS_ACCESS_KEY_ID=${aws_access_key}
AWS_SECRET_ACCESS_KEY=${aws_secret_key}
AWS_SESSION_TOKEN=${aws_session_token}
EOF

# Navigate to app directory
cd $APP_DIR

# Install dependencies
echo "Running 'npm install'..."
npm install

# --- ADDED: Wait for RDS to be ready ---
echo "Waiting 5 minutes (300 seconds) for RDS to be ready..."
sleep 300
# --------------------------------------

# Push database schema with Drizzle
echo "Running 'npm run drizzle:push'..."
npm run drizzle:push

# Start the application with PM2
echo "Starting Node.js app with PM2..."
pm2 start npm --name "talkit-app" -- start

# Configure PM2 to auto-restart on server boot
pm2 startup
pm2 save

# -----------------------------------------------------------------
# 4. RUN THE PYTHON DOCKER COMPOSE SERVICE
# -----------------------------------------------------------------
echo "--- Setting up Python Docker Compose service ---"
SCRIPT_TO_RUN="$APP_DIR/py_executor/start-docker-compose.sh"

# Make the script executable
chmod +x "$SCRIPT_TO_RUN"

# Run the script to start Docker Compose
echo "Running Docker Compose startup script: $SCRIPT_TO_RUN"
"$SCRIPT_TO_RUN"

# -----------------------------------------------------------------
# 5. SET PERMISSIONS
# -----------------------------------------------------------------
chown -R ec2-user:ec2-user $APP_DIR
chown -R ec2-user:ec2-user /home/ec2-user/.pm2

echo "User data script finished successfully."