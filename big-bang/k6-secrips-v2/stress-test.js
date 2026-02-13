/**
 * K6 스트레스 테스트 (Stress Test)
 *
 * ============================================================================
 * 스트레스 테스트란?
 * ============================================================================
 *
 * 시스템의 한계점(Breaking Point)을 찾기 위해 점진적으로 부하를 증가시키는 테스트입니다.
 *
 * 왜 필요한가?
 * 1. 시스템 한계점 발견
 *    - 몇 명의 동시 사용자까지 처리 가능한지 확인
 *    - 어느 시점에서 응답 시간이 급격히 증가하는지 식별
 *
 * 2. 장애 모드 분석
 *    - 한계 초과 시 어떻게 실패하는지 관찰
 *    - Graceful Degradation vs Complete Failure
 *
 * 3. 복구 능력 검증
 *    - 과부하 후 정상 트래픽으로 돌아왔을 때 복구되는지
 *    - 복구에 걸리는 시간 측정
 *
 * 4. 안전 마진 확보
 *    - 현재 인프라로 처리 가능한 최대치 파악
 *    - 예상 트래픽 대비 여유 용량 확인
 *
 * 주의사항:
 * - 프로덕션 환경에서 실행 금지!
 * - 스테이징 환경에서 실행 시 다른 테스트 일정과 충돌 확인
 * - 데이터베이스, 캐시 등 공유 리소스에 영향 줄 수 있음
 *
 * 실행 방법:
 * k6 run stress-test.js
 */

import { group, sleep } from 'k6';
import {
    STRESS_TEST_STAGES,
    randomString,
    getCurrentTime,
    getTimeAfterMinutes,
} from './config.js';
import { createReportOutput } from './report-generator.js';
import {
    signup,
    logout,
    getProfile,
    createSchedule,
    getSchedules,
    getSchedulesByDate,
    getDayPlanId,
    deleteSchedule,
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
     * 스트레스 테스트 단계 설정
     *
     * 점진적 증가 패턴으로 Breaking Point 발견:
     *
     * 2m: 0→50 VU (워밍업)
     * 3m: 50 VU (기준선 측정)
     * 2m: 50→100 VU (2배 부하)
     * 3m: 100 VU (안정화)
     * 2m: 100→200 VU (4배 부하)
     * 3m: 200 VU (안정화)
     * 2m: 200→300 VU (6배 부하 - Breaking Point 예상)
     * 3m: 300 VU (안정화)
     * 2m: 300→0 VU (복구)
     *
     * 총 22분 테스트
     *
     * 왜 이렇게 설정하는가?
     * - 2배씩 증가: 각 단계에서 성능 변화를 명확히 관찰
     * - 3분 유지: 해당 부하에서 안정 상태 도달 확인
     * - 최종 300 VU: 일반적인 서비스의 피크 트래픽 시뮬레이션
     */
    stages: STRESS_TEST_STAGES,

    /**
     * Graceful 종료 설정
     *
     * 테스트 종료 시 진행 중인 iteration이 완료될 때까지 대기
     * 스트레스 테스트는 더 긴 iteration을 가질 수 있으므로 여유있게 설정
     */
    gracefulStop: '60s',
    gracefulRampDown: '30s',

    /**
     * 스트레스 테스트 임계값
     *
     * 로드 테스트보다 완화된 기준:
     * - 시스템 한계를 찾는 것이 목적이므로 일부 실패 허용
     * - 응답 시간 기준도 여유 있게 설정
     */
    thresholds: {
        // 응답 시간 - 스트레스 상황에서는 더 긴 시간 허용
        http_req_duration: ['p(95)<5000', 'p(99)<10000'],
        // 실패율 - 5%까지 허용 (한계점 도달 예상)
        http_req_failed: ['rate<0.05'],
        // 커스텀 메트릭
        'signup_duration': ['p(95)<2000', 'p(99)<5000'],
        'create_schedule_duration': ['p(95)<3000', 'p(99)<5000'],
        'scenario_failures': ['rate<0.10'], // 시나리오 실패율 10% 미만
    },
};

// ============================================================================
// 메인 테스트 시나리오
// ============================================================================

/**
 * 스트레스 테스트 시나리오
 *
 * 로드 테스트보다 더 집약적인 작업 수행:
 * - Think Time 최소화로 더 높은 RPS(Requests Per Second) 생성
 * - 핵심 기능에 집중하여 병목 지점 명확히 식별
 *
 * 왜 이런 플로우인가?
 * - 로그인/스케줄 CRUD는 가장 리소스 집약적인 작업
 * - 불필요한 API 호출 제거하여 핵심 성능에 집중
 * - 빠른 반복으로 최대 부하 생성
 */
export default function () {
    const scenarioStart = new Date();
    let scenarioSuccess = true;

    // ========================================================================
    // 1. 회원가입 (고유 이메일 자동 생성)
    // ========================================================================

    let accessToken = null;

    group('signup', function () {
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

    // Think Time 최소화 - 스트레스 상황 시뮬레이션
    thinkTime(0.5, 1);

    // ========================================================================
    // 2. 프로필 + 스케줄 조회 (읽기 부하) + DayPlan ID 조회
    // ========================================================================

    /**
     * 읽기 작업을 먼저 수행하는 이유:
     * - DB 읽기 성능 측정
     * - 캐시 효율성 확인
     * - 읽기 복제본(Read Replica) 사용 시 분산 효과 확인
     * - dayPlanId를 동적으로 조회하여 스케줄 생성에 사용
     */

    let dayPlanId = null;

    group('read_operations', function () {
        getProfile(accessToken);
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

    thinkTime(0.5, 1);

    // ========================================================================
    // 3. 스케줄 생성 (쓰기 부하 - 가장 무거운 작업)
    // ========================================================================

    /**
     * 스케줄 생성이 왜 스트레스 테스트의 핵심인가?
     *
     * 1. DB 트랜잭션 필요
     *    - INSERT 쿼리 실행
     *    - 시간 충돌 검증 (SELECT for UPDATE)
     *
     * 2. 이벤트 발행
     *    - ApplicationEventPublisher 호출
     *    - 비동기 처리 부하
     *
     * 3. 동시성 제어
     *    - 같은 사용자의 동시 생성 요청 처리
     *    - 락 경합 가능성
     */

    let createdSchedule = null;

    group('write_operations', function () {
        const scheduleData = {
            type: 'FLEX',
            title: `Stress ${__VU}_${__ITER}_${randomString(4)}`,
            startAt: getCurrentTime(),
            endAt: getTimeAfterMinutes(30),
            estimatedTimeRange: 'MINUTE_30_TO_60',
            focusLevel: Math.floor(Math.random() * 5) + 1,
            isUrgent: false,
        };

        createdSchedule = createSchedule(accessToken, dayPlanId, scheduleData);

        if (!createdSchedule) {
            scenarioSuccess = false;
        }
    });

    thinkTime(0.5, 1);

    // ========================================================================
    // 4. 스케줄 목록 조회 (읽기 - 변경 확인)
    // ========================================================================

    group('verify_operations', function () {
        getSchedules(accessToken, dayPlanId);
    });

    thinkTime(0.5, 1);

    // ========================================================================
    // 5. 정리 (데이터 정리 및 로그아웃)
    // ========================================================================

    group('cleanup', function () {
        if (createdSchedule && createdSchedule.scheduleId) {
            deleteSchedule(accessToken, createdSchedule.scheduleId);
        }
        logout(accessToken);
    });

    // 메트릭 기록
    const scenarioDuration = new Date() - scenarioStart;
    fullScenarioDuration.add(scenarioDuration);
    scenarioFailRate.add(!scenarioSuccess);

    // 최소 대기 시간
    sleep(0.5);
}

// ============================================================================
// 라이프사이클 훅
// ============================================================================

export function setup() {
    console.log('========================================');
    console.log('💪 Stress Test Started');
    console.log('========================================');
    console.log(`Target: ${__ENV.K6_BASE_URL || 'http://localhost:8080'}`);
    console.log(`Max VUs: 300`);
    console.log(`Duration: ~22 minutes`);
    console.log('');
    console.log('⚠️  WARNING: This test will push the system to its limits!');
    console.log('');

    // 서버 헬스체크
    const isHealthy = healthCheck();
    if (!isHealthy) {
        throw new Error('Server health check failed');
    }

    return {
        startTime: new Date().toISOString(),
        testType: 'stress',
    };
}

export function teardown(data) {
    console.log('');
    console.log('========================================');
    console.log('✅ Stress Test Completed');
    console.log('========================================');
    console.log(`Test Type: ${data.testType}`);
    console.log(`Started: ${data.startTime}`);
    console.log(`Finished: ${new Date().toISOString()}`);
    console.log('');
    console.log('Analysis Points:');
    console.log('- At what VU count did response times degrade?');
    console.log('- What was the maximum throughput achieved?');
    console.log('- Did the system recover after peak load?');
    console.log('- Which endpoint showed the first signs of stress?');
}

export function handleSummary(data) {
    return createReportOutput(data, 'stress-test');
}
