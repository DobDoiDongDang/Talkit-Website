#!/bin/bash
set -euo pipefail # Stop on error

# -----------------------------------------------------------------
# 1. INSTALL ALL DEPENDENCIES
# -----------------------------------------------------------------
yum update -y
yum install -y git amazon-efs-utils

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
# 2. MOUNT EFS
# -----------------------------------------------------------------
mkdir -p /mnt/efs
mount -t efs ${efs_id}:/ /mnt/efs
echo "${efs_id}:/ /mnt/efs efs _netdev,tls 0 0" >> /etc/fstab

# -----------------------------------------------------------------
# 3. CLONE APP REPOSITORY
# -----------------------------------------------------------------
APP_DIR="/var/www/talkit-app"
mkdir -p $APP_DIR
git clone https://github.com/DobDoiDongDang/Talkit-Website.git $APP_DIR

# -----------------------------------------------------------------
# 4. SETUP AND RUN THE NODE.JS APPLICATION
# -----------------------------------------------------------------
echo "--- Setting up Node.js application ---"

# Create the .env file for the Node.js app
cat <<EOF > $APP_DIR/.env
DATABASE_URL=${db_url}
AWS_REGION=${aws_region}
COGNITO_CLIENT_ID=${cognito_client_id}
COGNITO_USER_POOL_ID=${cognito_user_pool_id}
AWS_S3_BUCKET=${aws_s3_bucket}
COGNITO_JWKS_URL=${cognito_jwks_url}
PORT=3000
NODE_TLS_REJECT_UNAUTHORIZED=0
EOF

# Navigate to app directory
cd $APP_DIR

# Install dependencies
echo "Running 'npm install'..."
npm install

# Push database schema with Drizzle
echo "Running 'npm run drizzle:push'..."
# Note: Ensure DB is reachable. RDS can take time to start.
# This might fail on first boot if DB isn't ready.
# A more robust solution uses a wait-for-it script.
npm run drizzle:push

# Start the application with PM2
echo "Starting Node.js app with PM2..."
pm2 start npm --name "talkit-app" -- start

# Configure PM2 to auto-restart on server boot
pm2 startup
pm2 save

# -----------------------------------------------------------------
# 5. RUN THE PYTHON DOCKER COMPOSE SERVICE
# -----------------------------------------------------------------
echo "--- Setting up Python Docker Compose service ---"
SCRIPT_TO_RUN="$APP_DIR/py_executor/start-docker-compose.sh"

# Make the script executable
chmod +x "$SCRIPT_TO_RUN"

# Run the script to start Docker Compose
echo "Running Docker Compose startup script: $SCRIPT_TO_RUN"
"$SCRIPT_TO_RUN"

# -----------------------------------------------------------------
# 6. SET PERMISSIONS
# -----------------------------------------------------------------
chown -R ec2-user:ec2-user $APP_DIR
chown -R ec2-user:ec2-user /mnt/efs
chown -R ec2-user:ec2-user /home/ec2-user/.pm2

echo "User data script finished successfully."