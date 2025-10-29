#!/bin/bash
set -euo pipefail # หยุดเมื่อ Error

APP_DIR="/var/www/talkit-app"
UBUNTU_HOME="/home/ubuntu"

echo "--- Starting User Data Script for Golden AMI ---"

# 1. สร้างไฟล์ .env (โดย root)
echo "Creating .env file..."
# สร้าง DB URL สำหรับ .env
DB_URL="postgresql://${db_user}:${db_pass}@${db_host}/${db_name}?sslmode=require&rejectUnauthorized=false&sslrootcert=./certs/global-bundle.pem"
cat <<EOF > $APP_DIR/.env
DATABASE_URL=$DB_URL
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

# ตรวจสอบ certs directory และดาวน์โหลด cert ถ้าจำเป็น (โดย root)
mkdir -p $APP_DIR/certs
if [ ! -f "$APP_DIR/certs/global-bundle.pem" ]; then
    echo "Downloading RDS SSL certificate..."
    curl -o $APP_DIR/certs/global-bundle.pem https://s3.amazonaws.com/rds-downloads/global-bundle.pem
fi
# ตั้งค่า Permissions ก่อนที่ user ubuntu จะใช้งาน
chown -R ubuntu:ubuntu $APP_DIR

# 2. อัปเดตโค้ดล่าสุด (โดย ubuntu)
echo "Pulling latest code..."
su - ubuntu -c "cd $APP_DIR && git pull origin main"

# 3. ติดตั้ง/อัปเดต Dependencies (โดย ubuntu)
echo "Running npm install..."
su - ubuntu -c '
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    cd /var/www/talkit-app
    npm install
'

# 4. รอฐานข้อมูล (โดย root)
echo "Waiting for DB at ${db_host}..."
# ใช้ postgresql-client ที่ติดตั้งบน AMI
until PGPASSWORD="${db_pass}" psql -h "${db_host}" -U "${db_user}" -d "${db_name}" -c '\q' > /dev/null 2>&1; do
  echo "DB not ready... waiting 5 seconds"
  sleep 5
done
echo "Database is ready!"

# 5. รัน Database Migration (โดย ubuntu)
echo "Running npm run db:push (or drizzle:push)..."
su - ubuntu -c '
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    cd /var/www/talkit-app
    # Export .env vars ภายใน subshell นี้
    export $(grep -v "^#" .env | xargs)
    # --- ‼️ ตรวจสอบชื่อคำสั่งนี้ให้ถูกต้อง ---
    npm run db:push
    # หรืออาจจะเป็น: npm run drizzle:push
    # ------------------------------------
'

# 6. สตาร์ท/รีสตาร์ทแอปด้วย PM2 (โดย ubuntu)
echo "Restarting PM2 app..."
su - ubuntu -c '
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    cd /var/www/talkit-app
    # Export .env vars อีกครั้งสำหรับ pm2 runtime
    export $(grep -v "^#" .env | xargs)
    # ใช้ restart ถ้าแอปเคยรันแล้ว || จะ start ถ้ายังไม่เคยรัน
    pm2 restart talkit-app || pm2 start npm --name "talkit-app" -- start
    # บันทึก process list ปัจจุบัน
    pm2 save
'

# 7. ตั้งค่า PM2 Startup Service (โดย root)
echo "Setting up PM2 startup service (as root)..."
# หา path ของ pm2 ที่ติดตั้งโดย nvm สำหรับ user 'ubuntu'
PM2_PATH=$(su - ubuntu -c 'export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" && nvm use 18 > /dev/null 2>&1 && which pm2')
# หา path ของ node ที่ nvm ใช้งานอยู่
NODE_VERSION=$(su - ubuntu -c 'export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" && node -v')
NODE_BIN_PATH="$NVM_DIR/versions/node/$NODE_VERSION/bin"
# รันคำสั่ง pm2 startup ที่ได้จาก pm2 โดยระบุ user และ home path ที่ถูกต้อง
env PATH=$PATH:/usr/bin:$NODE_BIN_PATH $PM2_PATH startup systemd -u ubuntu --hp $UBUNTU_HOME | bash

# 8. รัน Docker Compose (โดย root)
echo "Starting Docker Compose service..."
# ตรวจสอบว่าไฟล์ script มีอยู่จริง
if [ -f "$APP_DIR/py_executor/start-docker-compose.sh" ]; then
  chmod +x $APP_DIR/py_executor/start-docker-compose.sh
  $APP_DIR/py_executor/start-docker-compose.sh
else
  echo "Warning: start-docker-compose.sh not found in py_executor."
fi

# 9. ตรวจสอบ Permissions สุดท้าย (โดย root)
echo "Ensuring permissions..."
chown -R ubuntu:ubuntu $APP_DIR
mkdir -p $UBUNTU_HOME/.pm2 # สร้าง directory ถ้ายังไม่มี
chown -R ubuntu:ubuntu $UBUNTU_HOME/.pm2

echo "User data script finished."