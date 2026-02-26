/**
 * K6 부하 테스트 공통 설정 파일
 *
 * 왜 필요한가?
 * - 모든 테스트 스크립트에서 공통으로 사용하는 설정을 중앙 집중화
 * - 환경별(local, staging, production) 설정을 쉽게 전환 가능
 * - 테스트 임계값(thresholds)을 일관성 있게 관리
 */

// ============================================================================
// 환경 설정
// ============================================================================

/**
 * BASE_URL: 테스트 대상 서버 URL
 *
 * 환경변수 K6_BASE_URL로 오버라이드 가능
 * 예: K6_BASE_URL=https://api.molip.today k6 run load-test.js
 */
export const BASE_URL = 'https://molip.today/api/task' //'http://localhost:8080';

/**
 * 테스트 사용자 계정 풀
 *
 * 왜 여러 계정이 필요한가?
 * - 실제 서비스처럼 다양한 사용자가 동시에 접속하는 상황을 시뮬레이션
 * - 단일 계정 사용 시 세션/토큰 충돌 발생 가능
 * - 데이터베이스의 동시성 처리 능력을 정확히 측정
 */
export const TEST_USERS = [
    { email: 'loadtest1@test.com', password: 'Test1234!' },
    { email: 'loadtest2@test.com', password: 'Test1234!' },
    { email: 'loadtest3@test.com', password: 'Test1234!' },
    { email: 'loadtest4@test.com', password: 'Test1234!' },
    { email: 'loadtest5@test.com', password: 'Test1234!' },
];

// ============================================================================
// 성능 임계값 (Thresholds)
// ============================================================================

/**
 * 공통 성능 임계값 정의
 *
 * 왜 이런 값들을 설정하는가?
 *
 * 1. http_req_duration (응답 시간)
 *    - p(95) < 2000ms: 95%의 요청이 2초 이내 응답해야 함
 *    - p(99) < 5000ms: 99%의 요청이 5초 이내 응답해야 함
 *    → 사용자 경험 관점에서 2초 이상 대기는 이탈률 급증
 *
 * 2. http_req_failed (실패율)
 *    - rate < 0.01: 실패율 1% 미만
 *    → 99.9% 가용성 SLO 달성을 위한 기본 조건
 *
 * 3. http_reqs (처리량)
 *    - rate > 100: 초당 100개 이상의 요청 처리
 *    → 시스템의 최소 처리 능력 보장
 */
export const COMMON_THRESHOLDS = {
    // 전체 요청 응답 시간
    http_req_duration: ['p(95)<2000', 'p(99)<5000'],
    // 요청 실패율 (4xx, 5xx 응답)
    http_req_failed: ['rate<0.01'],
};

/**
 * 엔드포인트별 세부 임계값
 *
 * 왜 엔드포인트마다 다른 임계값이 필요한가?
 * - 인증: 빈번하게 호출되므로 빠른 응답 필수 (500ms)
 * - 스케줄 조회: 페이지네이션으로 데이터량 제한, 중간 수준 (1000ms)
 * - 스케줄 생성: DB 쓰기 작업 포함, 여유 있게 설정 (1500ms)
 * - AI 배치: 외부 AI 서비스 호출로 가장 느림 (5000ms)
 */
export const ENDPOINT_THRESHOLDS = {
    // 인증 관련 - 가장 빠른 응답 요구
    auth_login: {
        'http_req_duration{name:login}': ['p(95)<500', 'p(99)<1000'],
    },
    auth_refresh: {
        'http_req_duration{name:refresh_token}': ['p(95)<300', 'p(99)<500'],
    },

    // 사용자 관련
    user_profile: {
        'http_req_duration{name:get_profile}': ['p(95)<500', 'p(99)<1000'],
    },
    user_search: {
        'http_req_duration{name:search_users}': ['p(95)<1000', 'p(99)<2000'],
    },

    // 스케줄 관련 - 핵심 비즈니스 로직
    schedule_create: {
        'http_req_duration{name:create_schedule}': ['p(95)<1500', 'p(99)<3000'],
    },
    schedule_list: {
        'http_req_duration{name:get_schedules}': ['p(95)<1000', 'p(99)<2000'],
    },
    schedule_update: {
        'http_req_duration{name:update_schedule}': ['p(95)<1000', 'p(99)<2000'],
    },

    // AI 배치 - 외부 서비스 의존으로 가장 긴 타임아웃
    ai_arrangement: {
        'http_req_duration{name:ai_arrangement}': ['p(95)<5000', 'p(99)<10000'],
    },
};

// ============================================================================
// 테스트 시나리오별 VU(Virtual User) 설정
// ============================================================================

/**
 * 로드 테스트 단계 설정
 *
 * 왜 이런 패턴을 사용하는가?
 *
 * Ramp-up → Steady → Ramp-down 패턴:
 * 1. Ramp-up (2분): 점진적으로 사용자 증가
 *    → 시스템이 갑작스러운 부하에 적응할 시간 제공
 *    → 오토스케일링 시스템의 반응 시간 확보
 *
 * 2. Steady (5분): 목표 부하 유지
 *    → 안정 상태에서의 성능 측정
 *    → 메모리 누수, 커넥션 풀 고갈 등 지속적 문제 발견
 *
 * 3. Ramp-down (1분): 점진적으로 사용자 감소
 *    → 시스템의 정상 복구 능력 확인
 *    → 리소스 해제 검증
 */
export const LOAD_TEST_STAGES = [
    { duration: '2m', target: 30 },   // Ramp-up: 10 VU까지 증가
    { duration: '2m', target: 30 },   // Steady: 20 VU 유지
    { duration: '2m', target: 30 },   // Scale-up: 30 VU까지 증가
    { duration: '2m', target: 30 },  // Ramp-down 시작
    { duration: '2m', target: 30 },
    { duration: '2m', target: 20 }   // Ramp-down: 0으로 감소 (깔끔한 종료)
];

/**
 * 스트레스 테스트 단계 설정
 *
 * 왜 이런 패턴을 사용하는가?근데
 *
 * 점진적 증가 패턴으로 시스템의 한계점(Breaking Point) 발견:
 * - 각 단계에서 부하를 2배씩 증가
 * - 어느 시점에서 응답 시간이 급격히 증가하는지 확인
 * - 시스템이 완전히 실패하기 전 경고 신호 식별
 */
export const STRESS_TEST_STAGES = [
    { duration: '2m', target: 10 },   // 워밍업 50
    { duration: '3m', target: 10 },   // 기준선 측정 50
    { duration: '2m', target: 20 },  // 2배 부하 100
    { duration: '3m', target: 20 },  // 안정화 100
    { duration: '2m', target: 40 },  // 4배 부하 200
    { duration: '3m', target: 40 },  // 안정화 200
    { duration: '2m', target: 60 },  // 6배 부하 - Breaking Point 예상 300
    { duration: '3m', target: 60 },  // 안정화 300
    { duration: '2m', target: 0 },    // 복구 0
];

/**
 * 스파이크 테스트 단계 설정
 *
 * 왜 이런 패턴을 사용하는가?
 *
 * 실제 서비스에서 발생하는 트래픽 급증 시나리오 시뮬레이션:
 * - 마케팅 캠페인, 뉴스 노출, 바이럴 콘텐츠 등으로 인한 급격한 트래픽 증가
 * - 오토스케일링의 반응 속도 테스트
 * - 서킷브레이커, 레이트리미팅 등 보호 메커니즘 검증
 */
export const SPIKE_TEST_STAGES = [
    { duration: '1m', target: 10 },   // 정상 트래픽 10
    { duration: '10s', target: 100 }, // 급격한 스파이크 (50배 증가) 500
    { duration: '2m', target: 100 },  // 스파이크 유지 500
    { duration: '10s', target: 10 },  // 급격한 감소 10
    { duration: '2m', target: 10 },   // 복구 확인 10
    { duration: '10s', target: 100 }, // 두 번째 스파이크 500
    { duration: '2m', target: 100 },  // 스파이크 유지 500
    { duration: '1m', target: 0 },    // 종료 0
];

/**
 * 소크 테스트(Endurance Test) 단계 설정
 *
 * 왜 이런 패턴을 사용하는가?
 *
 * 장시간 운영 시 발생할 수 있는 문제 발견:
 * - 메모리 누수 (Memory Leak)
 * - 데이터베이스 커넥션 풀 고갈
 * - 파일 핸들 누수
 * - 캐시 비효율
 * - 로그 파일 크기 증가로 인한 디스크 풀
 *
 * 일반적으로 4-12시간 동안 실행하지만, 여기서는 2시간으로 설정
 */
export const SOAK_TEST_STAGES = [
    { duration: '5m', target: 100 },   // Ramp-up
    { duration: '2h', target: 100 },   // 2시간 동안 100 VU 유지
    { duration: '5m', target: 0 },     // Ramp-down
];

/**
 * 스모크 테스트 단계 설정
 *
 * 왜 이런 패턴을 사용하는가?
 *
 * 본격적인 부하 테스트 전 기본 기능 검증:
 * - 서버가 정상적으로 동작하는지 확인
 * - API 엔드포인트가 응답하는지 확인
 * - 테스트 스크립트 자체의 오류 발견
 * - CI/CD 파이프라인에서 빠른 검증용
 */
export const SMOKE_TEST_STAGES = [
    { duration: '30s', target: 1 },   // 단일 사용자로 시작
    { duration: '1m', target: 5 },    // 5 VU로 증가
    { duration: '30s', target: 0 },   // 종료
];

// ============================================================================
// HTTP 요청 기본 설정
// ============================================================================

/**
 * 기본 HTTP 헤더
 *
 * Content-Type: JSON API이므로 필수
 * Accept: 서버 응답 형식 지정
 */
export const DEFAULT_HEADERS = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
};

/**
 * 요청 타임아웃 설정 (밀리초)
 *
 * 왜 이 값들인가?
 * - 일반 API: 10초 - 대부분의 요청은 이 내에 완료되어야 함
 * - AI 관련: 30초 - 외부 AI 서비스 호출 시 긴 대기 시간 허용
 */
export const TIMEOUTS = {
    default: '10s',
    ai_related: '30s',
};

// ============================================================================
// 테스트 데이터 생성 유틸리티
// ============================================================================

/**
 * 랜덤 문자열 생성
 * 테스트 데이터의 고유성 보장을 위해 사용
 */
export function randomString(length) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

/**
 * 랜덤 이메일 생성
 * 회원가입 테스트 시 고유한 이메일 필요
 */
export function randomEmail() {
    return `loadtest_${randomString(8)}_${Date.now()}@test.com`;
}

/**
 * 랜덤 닉네임 생성
 */
export function randomNickname() {
    return `User_${randomString(6)}`;
}

/**
 * 오늘 날짜를 YYYY-MM-DD 형식으로 반환
 */
export function getTodayDate() {
    const now = new Date();
    return now.toISOString().split('T')[0];
}

/**
 * 현재 시간 기준 HH:mm 형식 반환
 */
export function getCurrentTime() {
    const now = new Date();
    return now.toTimeString().slice(0, 5);
}

/**
 * n분 후 시간 반환
 */
export function getTimeAfterMinutes(minutes) {
    const now = new Date();
    now.setMinutes(now.getMinutes() + minutes);
    return now.toTimeString().slice(0, 5);
}
