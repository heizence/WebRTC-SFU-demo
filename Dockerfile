FROM node:22.6.0-alpine

# mediasoup 빌드를 위한 도구 설치
RUN apk add --no-cache \
    python3 \
    py3-pip \
    make \
    g++ \
    linux-headers \
    git

WORKDIR /app

# package.json 복사
COPY package*.json ./

# 모든 의존성 설치 (dev 포함)
RUN npm ci

# 소스 복사
COPY . .

# TypeScript 빌드
RUN npm run build

# 프로덕션 의존성만 다시 설치 (용량 절약)
RUN npm ci --omit=dev

# mediasoup RTC 포트 노출
EXPOSE 3000
EXPOSE 40000-40100/udp

CMD ["npm", "start"]