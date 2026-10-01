# 나의 트레이딩

Next.js 소유자 전용 웹 화면과 Vercel Workflow 예약 실행으로 PC를 꺼도 봇을 실행하는 프로젝트입니다. 최초 설정은 **모의거래**입니다.

## 실행 구조

1. 로그인한 소유자가 웹에서 시작합니다.
2. Vercel Workflow가 바이낸스 BTCUSDT 15분 봉을 조회하고 처리합니다.
3. 처리 상태·거래·키는 PostgreSQL에 저장합니다. 재배포 후에도 유지됩니다.
4. 다음 봉 마감 5초 후까지 영구 예약으로 대기하고 새 실행을 시작합니다. 대기 중 PC나 브라우저가 필요하지 않습니다.

반복 Cron 설정이나 별도 VPS는 필요하지 않습니다. 예약 실행은 실시간 보장이 없으며, 지연된 신호는 신규 진입을 생략합니다. 실주문 모드에서는 손절·익절을 바이낸스 거래소의 조건부 주문으로 등록합니다.

## Vercel 배포

저장소를 Vercel에서 가져오고 Next.js 프리셋, 루트 `./`, Node 24를 사용합니다. `vercel.json`은 서울 실행 지역을 지정합니다. PostgreSQL을 생성하여 연결합니다. 무료 플랜에서도 사용량 한도와 거래소 접근 가능 여부를 확인해야 하며, 한도 초과·장애로 실행이 중지될 수 있습니다.

운영 환경 변수:

| 변수 | 값 |
| --- | --- |
| `DATABASE_URL` | TLS 연결이 설정된 영구 PostgreSQL 주소 |
| `ADMIN_PASSWORD_HASH` | `npm run setup`으로 생성한 scrypt 비밀번호 해시 |
| `CREDENTIAL_ENCRYPTION_KEY` | 같은 명령으로 생성한 32바이트 base64 키. 보관하고 재배포 때 유지 |
| `APP_ORIGIN` | 실제 웹 주소, 예: `https://bi-xxx.vercel.app` |
| `BOT_TRADING_MODE` | 최초 `paper` |
| `ALLOW_MAINNET_LIVE` | 최초 `false` |

실제 값은 GitHub, 이 문서, 화면 캡처, 채팅에 올리지 않습니다. `NEXT_PUBLIC_` 환경 변수로 설정하지 않습니다. 운영 DB와 비밀 값은 Production에만 넣습니다. Preview에 운영 자격증명을 공유하지 않습니다.

로컬 준비: `npm ci`, `npm run setup`, `npm run dev`. `.local/owner-access.txt`의 비밀번호로 로그인합니다. 이미 `.env.local`이 있으면 setup은 보존합니다. 로컬 SQLite는 개발용이며 Vercel에서는 사용하지 않습니다.

배포 후 로그인 → 모의거래 시작 → 최근 실행과 다음 예약 확인 → 웹을 닫은 뒤 다음 봉 이후 재접속하여 실행이 이어졌는지 확인합니다. Vercel Workflow 목록에서도 예약을 확인할 수 있습니다. 웹을 열었을 때만 실행되는 구조가 아닙니다.

## API 키 저장 위치

웹의 **API 키 관리**에서 테스트 또는 실계정 키를 입력하고 **암호화하여 저장**을 누릅니다. AES-256-GCM으로 서버에서 암호화해 DB에 저장하며, 로그아웃과 재배포 후에도 유지됩니다. 브라우저에는 마스킹된 키만 반환합니다. Workflow 입력/결과에도 키를 넣지 않습니다. 암호화 키를 잃으면 저장된 API 키를 복구할 수 없습니다.

키 저장만으로 실주문은 시작되지 않습니다. 테스트 계정 모드는 `BOT_TRADING_MODE=testnet`, 실계정은 `mainnet`과 `ALLOW_MAINNET_LIVE=true`를 운영 설정에 적용한 뒤 재배포해야 합니다. 주문 모드의 시작에는 화면의 추가 확인 문구가 필요합니다. 실계정 전환 전에 Demo 체결·손절·익절을 실제로 검증해야 합니다. 출금 권한은 사용하지 않습니다. IP 제한을 사용하는 키에는 Vercel의 출발 IP 조건을 별도로 충족해야 합니다.

## 중지와 복구

중지는 다음 실행과 신규 진입을 막습니다. 이미 시작된 주문의 보호 설정은 마무리되며, 보유 포지션과 거래소 주문은 자동 취소되지 않습니다. 열린 포지션이 있으면 거래소에서 확인합니다. 키 삭제는 해당 모드 봇을 중지하지만 포지션을 청산하지 않습니다.

주문 전 의도를 DB에 먼저 기록합니다. 타임아웃이나 프로세스 중단 후에는 자동 재주문하지 않습니다. `pending` 상태가 있으면 시작도 거절합니다. 이 경우 거래소 주문·체결·보호 주문을 조회해 DB 기록을 복구해야 합니다. 보호 주문 등록 실패에는 reduce-only 긴급 청산을 한 번 시도하고, 그 결과가 불확실해도 반복 주문하지 않습니다. 수동 거래가 섞인 전용 계정 외 사용은 권장하지 않으며, 불일치가 감지되면 중지합니다.

모의거래는 마감된 봉의 고가·저가로 청산을 판단합니다. 한 봉에서 손절·익절이 모두 닿으면 손절을 먼저 적용합니다. 기존 PC의 5초 주기 가격 감시와 결과가 동일하지 않습니다. 기본 전략 지표·점수·위험 제한을 TypeScript로 이식했으며, 기존 로컬 거래 기록을 자동 이관하지 않습니다.

검증: `npm test`, `npm run build`, `npm audit --omit=dev`. 실제 자금 주문은 검증 명령에 포함되지 않습니다.

공식 문서: [Vercel Workflow](https://useworkflow.dev/docs/foundations/starting-workflows), [Vercel 요금](https://vercel.com/pricing), [Binance USDⓈ-M API](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/trade).
