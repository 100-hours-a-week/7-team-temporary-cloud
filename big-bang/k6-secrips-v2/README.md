# K6 부하 테스트 스위트

이 디렉토리는 molip 백엔드 서비스를 위한 종합적인 k6 부하 테스트 스크립트를 포함합니다.

## 테스트 종류

| 테스트 | 파일 | 목적 | 실행 시간 | 최대 VU |
|--------|------|------|----------|---------|
| **Smoke** | `smoke-test.js` | 기본 기능 검증 | 2분 | 5 |
| **Load** | `load-test.js` | 정상 부하 성능 측정 | 15분 | 100 |
| **Stress** | `stress-test.js` | 한계점 근처 성능 | 22분 | 300 |
| **Spike** | `spike-test.js` | 트래픽 급증 대응 | 9분 | 500 |
| **Soak** | `soak-test.js` | 장시간 안정성 | 2시간+ | 100 |
| **Breakpoint** | `breakpoint-test.js` | 절대 한계점 탐색 | 17분 | 1000 |
| **Scenario** | `scenario-test.js` | 사용자 유형별 시뮬레이션 | 10분 | 100 |

## 빠른 시작

### 1. k6 설치

```bash
# macOS
brew install k6

# Docker
docker pull grafana/k6
```

### 2. 테스트 사용자 생성

테스트 실행 전 DB에 테스트 사용자를 생성해야 합니다:

```sql
-- 테스트 사용자 5명 생성 (비밀번호: Test1234!)
INSERT INTO users (email, password, nickname, gender, birth, focus_time_zone, day_end_time)
VALUES
('loadtest1@test.com', '$2a$10$...', 'LoadTest1', 'MALE', '1990-01-01', 'MORNING', '23:00'),
('loadtest2@test.com', '$2a$10$...', 'LoadTest2', 'MALE', '1990-01-01', 'MORNING', '23:00'),
('loadtest3@test.com', '$2a$10$...', 'LoadTest3', 'MALE', '1990-01-01', 'MORNING', '23:00'),
('loadtest4@test.com', '$2a$10$...', 'LoadTest4', 'MALE', '1990-01-01', 'MORNING', '23:00'),
('loadtest5@test.com', '$2a$10$...', 'LoadTest5', 'MALE', '1990-01-01', 'MORNING', '23:00');
```

### 3. 테스트 실행

```bash
# 로컬 서버 대상
k6 run smoke-test.js

# 스테이징 서버 대상
K6_BASE_URL=https://staging.api.molip.today k6 run smoke-test.js

# 결과를 InfluxDB로 전송
k6 run --out influxdb=http://localhost:8086/k6 load-test.js
```

## 테스트별 상세 설명

### Smoke Test (스모크 테스트)
```bash
k6 run smoke-test.js
```
- **목적**: 배포 후 빠른 기능 검증
- **사용 시점**: CI/CD 파이프라인, 배포 직후
- **특징**: 최소 부하, 빠른 실행, 기본 기능 확인

### Load Test (로드 테스트)
```bash
k6 run load-test.js
```
- **목적**: 예상 트래픽에서의 성능 기준선 수립
- **사용 시점**: 릴리스 전, 정기 성능 검증
- **특징**: 실제 사용 패턴 시뮬레이션, SLO 검증

### Stress Test (스트레스 테스트)
```bash
k6 run stress-test.js
```
- **목적**: 시스템 한계 근처에서의 동작 확인
- **사용 시점**: 용량 계획, 스케일링 임계값 설정
- **특징**: 점진적 부하 증가, 복구 능력 확인

### Spike Test (스파이크 테스트)
```bash
k6 run spike-test.js
```
- **목적**: 급격한 트래픽 증가 대응 능력 검증
- **사용 시점**: 마케팅 캠페인 전, 오토스케일링 검증
- **특징**: 50배 급증, 연속 스파이크, 복구 시간 측정

### Soak Test (소크 테스트)
```bash
k6 run soak-test.js

# 4시간 실행
K6_SOAK_DURATION=4h k6 run soak-test.js
```
- **목적**: 장시간 운영 안정성 검증
- **사용 시점**: 메이저 릴리스 전, 메모리 누수 의심 시
- **특징**: 장시간 일정 부하, 리소스 누수 발견

### Breakpoint Test (브레이크포인트 테스트)
```bash
k6 run breakpoint-test.js
```
- **목적**: 시스템의 절대적 한계점 탐색
- **사용 시점**: 인프라 용량 계획
- **주의**: 프로덕션에서 절대 실행 금지!

### Scenario Test (시나리오 테스트)
```bash
k6 run scenario-test.js
```
- **목적**: 다양한 사용자 유형 동시 시뮬레이션
- **사용 시점**: 실제 트래픽 패턴 반영 필요 시
- **특징**: 신규/재방문/활성/파워 유저 믹스

## 환경 변수

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `K6_BASE_URL` | 테스트 대상 서버 URL | `http://localhost:8080` |
| `K6_SOAK_DURATION` | 소크 테스트 지속 시간 | `2h` |

## 결과 분석

### 주요 메트릭

- **http_req_duration**: 응답 시간 (p95 < 2초 권장)
- **http_req_failed**: 실패율 (< 1% 권장)
- **http_reqs**: 처리량 (requests/second)
- **vus**: 동시 가상 사용자 수

### 커스텀 메트릭

- **login_duration**: 로그인 응답 시간
- **create_schedule_duration**: 스케줄 생성 응답 시간
- **get_schedules_duration**: 스케줄 조회 응답 시간
- **ai_arrangement_duration**: AI 배치 응답 시간
- **scenario_failures**: 시나리오 실패율

### Grafana 대시보드 연동

```bash
# InfluxDB + Grafana 사용 시
k6 run --out influxdb=http://localhost:8086/k6 load-test.js
```

## 파일 구조

```
k6-tests/
├── config.js          # 공통 설정 (URL, 임계값, 단계)
├── helpers.js         # API 호출 헬퍼 함수
├── smoke-test.js      # 스모크 테스트
├── load-test.js       # 로드 테스트
├── stress-test.js     # 스트레스 테스트
├── spike-test.js      # 스파이크 테스트
├── soak-test.js       # 소크 테스트
├── breakpoint-test.js # 브레이크포인트 테스트
├── scenario-test.js   # 시나리오 테스트
└── README.md          # 이 문서
```

## 테스트 커스터마이징

### 테스트 사용자 추가

`config.js`의 `TEST_USERS` 배열을 수정:

```javascript
export const TEST_USERS = [
    { email: 'custom1@test.com', password: 'Password1!' },
    // ...
];
```

### 임계값 조정

`config.js`의 `COMMON_THRESHOLDS` 또는 각 테스트 파일의 `options.thresholds` 수정

### 단계 조정

`config.js`의 `*_TEST_STAGES` 상수 수정

## 권장 실행 순서

1. **Smoke Test** → 기본 동작 확인
2. **Load Test** → 성능 기준선 수립
3. **Stress Test** → 한계 근처 동작 확인
4. **Spike Test** → 급증 대응 확인
5. **Soak Test** → 장시간 안정성 확인
6. **Breakpoint Test** → (필요시) 절대 한계 탐색

## 주의사항

- 프로덕션 환경에서 Stress/Spike/Breakpoint 테스트 실행 금지
- 테스트 전 모니터링 도구(Prometheus, Grafana) 준비
- 테스트 후 생성된 테스트 데이터 정리
- DB 커넥션 풀, 메모리 사용량 모니터링 병행
