# 阿里云 ECS 部署指南

适用于本项目在阿里云 ECS Ubuntu 22.04、2 核 4GB 服务器上的面试展示部署。

## 1. 服务器与安全组

服务器需要有公网 IPv4。安全组入方向开放：

- 22：SSH
- 80：HTTP
- 443：HTTPS

不要开放 3000 和 5432。部署完成后，将 22 端口来源限制为自己的公网 IP。

## 2. 连接服务器

在 Windows PowerShell 中执行：

    ssh root@你的公网IPv4

首次连接提示指纹时输入 yes。密码不会显示字符，输入完成后直接按回车。

## 3. 安装 Docker 和 Git

登录服务器后逐条执行：

    apt-get update
    apt-get install -y docker.io docker-compose-v2 git
    systemctl enable --now docker

检查安装：

    docker --version
    docker compose version
    git --version

## 4. 配置 1GB Swap

    fallocate -l 1G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    free -h

## 5. 上传项目

如果项目有 Git 仓库：

    cd /opt
    git clone 你的仓库地址 Idea2Screenplay-source
    cd /opt/Idea2Screenplay-source

也可以通过阿里云 Workbench、SFTP 或 SCP 上传项目到 /opt/Idea2Screenplay-source。

确认生产文件：

    test -f docker-compose.prod.yml && echo production-compose-found
    test -f docs/IP_DEPLOYMENT.md && echo ip-guide-found

## 6. 配置生产环境

在项目根目录执行：

    cp .env.example .env.production
    nano .env.production

至少确认或修改：

    NODE_ENV=production
    PUBLIC_IP=你的公网IPv4
    POSTGRES_PASSWORD=强密码
    COOKIE_SIGNING_KEY=随机长字符串
    VISITOR_IDENTITY_KEY=随机长字符串
    IP_HASH_KEY=随机长字符串
    ALTCHA_HMAC_KEY=随机长字符串
    AUTH_THROTTLE_KEY=随机长字符串
    AUTH_SESSION_DAYS=30
    DEMO_MODE=true

生成随机密钥：

    openssl rand -hex 32

不要把 .env.production 提交到 Git 或发送给他人。

## 7. 先配置 HTTPS

账号密码注册和登录禁止运行在明文 HTTP 上。先按 [固定公网 IP 部署手册](./IP_DEPLOYMENT.md) 完成 HTTP bootstrap、Certbot IP 证书签发和 HTTPS 切换；bootstrap 阶段只检查公开首页和健康状态，不要输入真实密码。

从旧访问码版本升级时，可暂时把原 `APP_ACCESS_CODES` 保留在 `.env.production`，仅用于让带旧 Cookie 的浏览器在注册时认领原项目。新页面和接口不再接收访问码；全新部署保持 `APP_ACCESS_CODES=` 即可。

## 8. 启动生产服务

    docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build

查看状态：

    docker compose --env-file .env.production -f docker-compose.prod.yml ps

查看日志：

    docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail=100 api
    docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail=100 web

## 9. 验证访问

服务器内检查 API：

    curl http://127.0.0.1:3000/api/health

浏览器仅使用 HTTPS 验证注册和登录：

    https://你的公网IPv4

`http://你的公网IPv4` 应自动跳转到 HTTPS。确认浏览器显示受信任证书后，才可输入真实密码。

## 10. 常用运维命令

重启：

    docker compose --env-file .env.production -f docker-compose.prod.yml restart

停止：

    docker compose --env-file .env.production -f docker-compose.prod.yml down

更新代码并重建：

    git pull
    docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build

查看资源：

    df -h
    free -h
    docker system df

## 11. 面试结束后的费用控制

面试结束后停止服务：

    docker compose --env-file .env.production -f docker-compose.prod.yml down

然后在阿里云 ECS 控制台停止实例。确定不再使用时，再释放实例和云盘；释放前先备份需要保留的数据。

注意：不要公开数据库密码、模型 API Key、SSH 密码或 .env.production。
