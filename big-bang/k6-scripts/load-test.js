/**
 * K6 로드 테스트 (Load Test)
 *
 * ============================================================================
 * 로드 테스트란?
 * ============================================================================
 *
 * 예상되는 정상 트래픽 수준에서 시스템의 성능을 측정하는 테스트입니다.
 *
 * 왜 필요한가?
 * 1. 용량 계획 (Capacity Planning)
 *    - 현재 인프라가 예상 사용자 수를 감당할 수 있는지 확인
 *    - 스케일 업/아웃이 필요한 시점 예측
 *
 * 2. 성능 기준선 수립 (Baseline)
 *    - 정상 상태의 응답 시간, 처리량 측정
 *    - 이후 테스트나 운영 지표와 비교하기 위한 기준
 *
 * 3. SLO(Service Level Objective) 검증
 *    - 서비스 수준 목표 달성 여부 확인
 *    - 예: "95%의 요청이 2초 이내 응답"
 *
 * 4. 병목 지점 발견
 *    - CPU, 메모리, DB 커넥션 등 리소스 사용량 모니터링
 *    - 특정 API의 비정상적인 응답 시간 식별
 *
 * 언제 실행하는가?
 * - 주요 릴리스 전 정기적으로 실행
 * - 인프라 변경 후 (DB 마이그레이션, 서버 스케일링 등)
 * - 성능 관련 코드 변경 후
 *
 * 실행 방법:
 * k6 run load-test.js
 * k6 run --out influxdb=http://localhost:8086/k6 load-test.js
 */

import { group, sleep } from 'k6';
import {
    LOAD_TEST_STAGES,
    COMMON_THRESHOLDS,
    ENDPOINT_THRESHOLDS,
    randomString,
    getCurrentTime,
    getTimeAfterMinutes,
} from './config.js';
import { createReportOutput } from './report-generator.js';
import {
    signup,
    logout,
    getProfile,
    searchUsers,
    createSchedule,
    getSchedules,
    getSchedulesByDate,
    getDayPlanId,
    updateSchedule,
    updateScheduleStatus,
    deleteSchedule,
    getNotifications,
    healthCheck,
    thinkTime,
    signupDuration,
    createScheduleDuration,
    getSchedulesDuration,
    fullScenarioDuration,
    scenarioFailRate,
} from './helpers.js';

// ============================================================================
// 테스트 설정
// ============================================================================

export const options = {
    /**
     * 로드 테스트 단계 설정
     *
     * 2m: 0→50 VU (Ramp-up)
     * 5m: 50 VU (Steady)
     * 2m: 50→100 VU (Scale-up)
     * 5m: 100 VU (Steady)
     * 1m: 100→0 VU (Ramp-down)
     *
     * 총 15분 테스트
     *
     * 왜 이렇게 설정하는가?
     * - Ramp-up: 급격한 부하 증가 방지, 오토스케일링 시간 확보
     * - Steady: 안정 상태에서의 성능 측정, 통계적 유의성 확보
     * - Scale-up: 트래픽 증가 시 시스템 반응 확인
     * - Ramp-down: 리소스 정상 해제 확인
     */
    stages: LOAD_TEST_STAGES,

    /**
     * 성능 임계값
     *
     * 로드 테스트에서는 일반적인 운영 기준 적용:
     * - 95%ile 응답 시간 2초 이내
     * - 실패율 1% 미만
     * - 초당 100개 이상 처리
     */
    thresholds: {
        ...COMMON_THRESHOLDS,
        ...ENDPOINT_THRESHOLDS.auth_login,
        ...ENDPOINT_THRESHOLDS.schedule_create,
        ...ENDPOINT_THRESHOLDS.schedule_list,

        // 커스텀 메트릭 임계값
        'signup_duration': ['p(95)<2000', 'p(99)<3000'],
        'create_schedule_duration': ['p(95)<1500', 'p(99)<3000'],
        'get_schedules_duration': ['p(95)<1000', 'p(99)<2000'],
        'full_scenario_duration': ['p(95)<10000', 'p(99)<15000'],
        'scenario_failures': ['rate<0.05'], // 시나리오 실패율 5% 미만
    },
};

// ============================================================================
// 메인 테스트 시나리오
// ============================================================================

/**
 * 로드 테스트 메인 시나리오
 *
 * 실제 사용자의 일반적인 사용 패턴을 시뮬레이션:
 *
 * 1. 로그인 → 프로필 조회 (앱 실행)
 * 2. 오늘 스케줄 조회 (메인 화면)
 * 3. 새 스케줄 생성 (일정 추가)
 * 4. 스케줄 목록 조회 (결과 확인)
 * 5. 스케줄 상태 변경 (일정 완료 처리)
 * 6. 사용자 검색 (친구 찾기)
 * 7. 알림 확인
 * 8. 로그아웃
 *
 * 왜 이런 플로우인가?
 * - 실제 DAU(Daily Active User)의 평균적인 행동 패턴 반영
 * - 읽기/쓰기 비율이 실제 서비스와 유사하도록 구성
 * - 각 단계 사이에 Think Time을 넣어 현실적인 부하 생성
 */
export default function () {
    const scenarioStart = new Date();
    let scenarioSuccess = true;

    // ========================================================================
    // Phase 1: 회원가입 (고유 이메일 자동 생성)
    // ========================================================================

    /**
     * 그룹을 사용하는 이유:
     * - k6 결과에서 각 단계별 성능을 구분하여 분석 가능
     * - 어느 단계에서 문제가 발생했는지 쉽게 식별
     *
     * 왜 회원가입을 사용하는가?
     * - 매 테스트마다 새로운 사용자로 독립적인 테스트
     * - 이메일은 타임스탬프 + 랜덤 문자열로 중복 방지
     */
    let accessToken = null;

    group('01_Signup', function () {
        const signupResult = signup();
        if (!signupResult) {
            scenarioSuccess = false;
            return;
        }
        accessToken = signupResult.accessToken;
    });

    if (!accessToken) {
        scenarioFailRate.add(true);
        return;
    }

    thinkTime(1, 2);

    // ========================================================================
    // Phase 2: 프로필 및 초기 데이터 로드 + DayPlan ID 조회
    // ========================================================================

    let userProfile = null;
    let dayPlanId = null;

    group('02_Initial_Load', function () {
        // 프로필 조회 - 앱 실행 시 항상 호출
        userProfile = getProfile(accessToken);

        // 오늘 스케줄 조회 - 메인 화면 표시 + dayPlanId 추출
        const scheduleInfo = getSchedulesByDate(accessToken);
        if (scheduleInfo && scheduleInfo.dayPlanId) {
            dayPlanId = scheduleInfo.dayPlanId;
        }
    });

    if (!dayPlanId) {
        console.warn(`VU ${__VU}: Failed to get dayPlanId`);
        scenarioFailRate.add(true);
        return;
    }

    thinkTime(2, 4);

    // ========================================================================
    // Phase 3: 스케줄 CRUD 작업
    // ========================================================================

    /**
     * 스케줄 CRUD가 왜 핵심 테스트 대상인가?
     *
     * 1. 가장 자주 사용되는 기능
     *    - 일정 관리 앱의 핵심 가치
     *    - DAU당 평균 3-5회 이상 호출
     *
     * 2. 복잡한 비즈니스 로직
     *    - 시간 충돌 검증, 이벤트 발행, 알림 트리거
     *    - DB 읽기/쓰기가 복합적으로 발생
     *
     * 3. 동시성 이슈 가능성
     *    - 같은 시간대 중복 생성 방지
     *    - 낙관적/비관적 락 필요
     */

    let createdSchedule = null;

    group('03_Schedule_Operations', function () {
        // 3-1. 스케줄 생성
        const scheduleData = {
            type: 'FLEX',
            title: `Load Test ${randomString(5)}`,
            startAt: getCurrentTime(),
            endAt: getTimeAfterMinutes(60),
            estimatedTimeRange: 'HOUR_1_TO_2',
            focusLevel: 3,
            isUrgent: false,
        };

        createdSchedule = createSchedule(accessToken, dayPlanId, scheduleData);

        if (!createdSchedule) {
            console.warn(`VU ${__VU}: Schedule creation failed`);
            scenarioSuccess = false;
        }

        thinkTime(1, 2);

        // 3-2. 스케줄 목록 조회 (생성 결과 확인)
        getSchedules(accessToken, dayPlanId);

        thinkTime(1, 2);

        // 3-3. 스케줄 상태 변경 (완료 처리)
        if (createdSchedule && createdSchedule.scheduleId) {
            updateScheduleStatus(accessToken, createdSchedule.scheduleId, 'DONE');
        }
    });

    thinkTime(2, 3);

    // ========================================================================
    // Phase 4: 소셜 기능
    // ========================================================================

    group('04_Social_Features', function () {
        // 사용자 검색 - 친구 찾기 시뮬레이션
        searchUsers(accessToken, 'User', 1, 10);

        thinkTime(1, 2);

        // 알림 확인
        getNotifications(accessToken);
    });

    thinkTime(1, 2);

    // ========================================================================
    // Phase 5: 정리 및 로그아웃
    // ========================================================================

    group('05_Cleanup', function () {
        // 테스트로 생성한 스케줄 삭제 (DB 정리)
        if (createdSchedule && createdSchedule.scheduleId) {
            deleteSchedule(accessToken, createdSchedule.scheduleId);
        }

        // 로그아웃
        logout(accessToken);
    });

    // ========================================================================
    // 시나리오 완료 메트릭 기록
    // ========================================================================

    const scenarioDuration = new Date() - scenarioStart;
    fullScenarioDuration.add(scenarioDuration);
    scenarioFailRate.add(!scenarioSuccess);

    // 다음 반복 전 대기
    sleep(1);
}

// ============================================================================
// 라이프사이클 훅
// ============================================================================

export function setup() {
    console.log('========================================');
    console.log('📊 Load Test Started');
    console.log('========================================');
    console.log(`Target: ${__ENV.K6_BASE_URL || 'http://localhost:8080'}`);
    console.log(`Max VUs: 100`);
    console.log(`Duration: ~15 minutes`);
    console.log('');

    // 서버 헬스체크
    const isHealthy = healthCheck();
    if (!isHealthy) {
        throw new Error('Server health check failed');
    }

    return {
        startTime: new Date().toISOString(),
        testType: 'load',
    };
}

export function teardown(data) {
    console.log('');
    console.log('========================================');
    console.log('✅ Load Test Completed');
    console.log('========================================');
    console.log(`Test Type: ${data.testType}`);
    console.log(`Started: ${data.startTime}`);
    console.log(`Finished: ${new Date().toISOString()}`);
    console.log('');
    console.log('Key Metrics to Review:');
    console.log('- http_req_duration: Overall response times');
    console.log('- login_duration: Authentication performance');
    console.log('- create_schedule_duration: Core business logic');
    console.log('- scenario_failures: End-to-end success rate');
}

export function handleSummary(data) {
    return createReportOutput(data, 'load-test');
}
