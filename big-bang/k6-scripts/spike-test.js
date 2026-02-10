/**
 * K6 스파이크 테스트 (Spike Test)
 *
 * ============================================================================
 * 스파이크 테스트란?
 * ============================================================================
 *
 * 트래픽이 갑자기 급증했다가 급감하는 상황을 시뮬레이션하는 테스트입니다.
 *
 * 왜 필요한가?
 * 1. 실제 서비스에서 발생하는 트래픽 급증 시나리오 대비
 *    - 마케팅 캠페인 시작 (푸시 알림 발송 후)
 *    - 뉴스/미디어 노출
 *    - 바이럴 콘텐츠
 *    - 특정 이벤트 시간대 (예: 월요일 아침 출근 시간)
 *
 * 2. 오토스케일링 검증
 *    - 스케일 아웃 트리거가 제대로 동작하는지
 *    - 스케일 인/아웃 속도가 충분한지
 *    - 쿨다운 기간 설정이 적절한지
 *
 * 3. 보호 메커니즘 검증
 *    - Rate Limiting (Bucket4j)이 제대로 동작하는지
 *    - Circuit Breaker 패턴이 적용되어 있다면 동작 확인
 *    - Queue/Buffer가 있다면 오버플로우 처리 확인
 *
 * 4. 사용자 경험 영향도 측정
 *    - 스파이크 중 기존 사용자의 경험 저하 정도
 *    - 스파이크 후 정상화까지 걸리는 시간
 *
 * 실행 방법:
 * k6 run spike-test.js
 */

import { group, sleep } from 'k6';
import {
    SPIKE_TEST_STAGES,
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
    getSchedulesByDate,
    getDayPlanId,
    deleteSchedule,
    healthCheck,
    thinkTime,
    fullScenarioDuration,
    scenarioFailRate,
} from './helpers.js';

// ============================================================================
// 테스트 설정
// ============================================================================

export const options = {
    /**
     * 스파이크 테스트 단계 설정
     *
     * 1m: 10 VU (정상 트래픽)
     * 10s: 10→500 VU (급격한 스파이크 - 50배 증가!)
     * 2m: 500 VU (스파이크 유지)
     * 10s: 500→10 VU (급격한 감소)
     * 2m: 10 VU (복구 확인)
     * 10s: 10→500 VU (두 번째 스파이크)
     * 2m: 500 VU (스파이크 유지)
     * 1m: 500→0 VU (종료)
     *
     * 총 ~9분 테스트
     *
     * 왜 이렇게 설정하는가?
     * - 10초 내 50배 증가: 실제 바이럴 상황 시뮬레이션
     * - 두 번의 스파이크: 연속 스파이크 대응 능력 확인
     * - 2분 유지: 스파이크 동안 안정성 확인
     * - 중간 복구 구간: 복구 후 두 번째 스파이크 대응 능력
     */
    stages: SPIKE_TEST_STAGES,

    /**
     * 스파이크 테스트 임계값
     *
     * 스파이크 상황에서는 일시적인 성능 저하 예상:
     * - 응답 시간이 일시적으로 증가하는 것은 허용
     * - 하지만 완전한 장애(타임아웃)는 최소화해야 함
     */
    thresholds: {
        // 스파이크 시 응답 시간 여유 있게 설정
        http_req_duration: ['p(90)<10000', 'p(95)<15000'],
        // 실패율 - 스파이크 시 일부 실패 허용 (10%)
        http_req_failed: ['rate<0.10'],
        // 하지만 완전한 타임아웃은 5% 미만
        http_req_receiving: ['p(99)<5000'],
        // 시나리오 성공률
        'scenario_failures': ['rate<0.15'],
    },
};

// ============================================================================
// 메인 테스트 시나리오
// ============================================================================

/**
 * 스파이크 테스트 시나리오
 *
 * 최대한 빠르게 반복하여 순간 부하 극대화:
 * - Think Time 거의 없음
 * - 핵심 작업만 수행
 * - 빠른 실패 시 바로 다음 반복으로
 *
 * 왜 이런 플로우인가?
 * - 스파이크 상황에서는 많은 사용자가 동시에 앱을 실행
 * - 로그인 → 메인 화면 조회가 가장 흔한 패턴
 * - 일부 사용자만 데이터 생성 (쓰기 비율 낮음)
 */
export default function () {
    const scenarioStart = new Date();
    let scenarioSuccess = true;

    // ========================================================================
    // 1. 빠른 회원가입 (고유 이메일 자동 생성)
    // ========================================================================

    let accessToken = null;

    group('quick_signup', function () {
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

    // 스파이크 시뮬레이션: 최소 대기
    sleep(0.1);

    // ========================================================================
    // 2. 메인 화면 데이터 로드 (가장 흔한 작업) + DayPlan ID 조회
    // ========================================================================

    /**
     * 스파이크 시 가장 많이 호출되는 API:
     * - 사용자 프로필 (세션 정보)
     * - 오늘 스케줄 (메인 화면)
     *
     * 이 두 API가 버틸 수 있어야 함
     * dayPlanId도 동적으로 조회하여 스케줄 생성에 사용
     */

    let dayPlanId = null;

    group('main_screen', function () {
        getProfile(accessToken);
        const scheduleInfo = getSchedulesByDate(accessToken);
        if (scheduleInfo && scheduleInfo.dayPlanId) {
            dayPlanId = scheduleInfo.dayPlanId;
        }
    });

    sleep(0.1);

    // dayPlanId 조회 실패 시 스케줄 생성 건너뛰기
    if (!dayPlanId) {
        console.warn(`VU ${__VU}: Failed to get dayPlanId, skipping schedule creation`);
    }

    // ========================================================================
    // 3. 일부 사용자만 데이터 생성 (20% 확률)
    // ========================================================================

    /**
     * 왜 일부만 생성하는가?
     * - 실제로 앱 실행 후 바로 일정 추가하는 비율은 낮음
     * - 읽기:쓰기 비율을 현실적으로 유지 (약 5:1)
     * - 스파이크 시 쓰기 작업이 병목이 되는지 확인
     */

    const shouldCreateSchedule = dayPlanId && Math.random() < 0.2; // 20% 확률, dayPlanId 있을 때만
    let createdSchedule = null;

    if (shouldCreateSchedule) {
        group('create_schedule', function () {
            const scheduleData = {
                type: 'FLEX',
                title: `Spike ${__VU}_${randomString(4)}`,
                startAt: getCurrentTime(),
                endAt: getTimeAfterMinutes(30),
                estimatedTimeRange: 'MINUTE_30_TO_60',
                focusLevel: 3,
                isUrgent: false,
            };

            createdSchedule = createSchedule(accessToken, dayPlanId, scheduleData);
        });

        sleep(0.1);

        // 생성한 스케줄 정리
        if (createdSchedule && createdSchedule.scheduleId) {
            deleteSchedule(accessToken, createdSchedule.scheduleId);
        }
    }

    // ========================================================================
    // 4. 로그아웃 (일부만 - 50% 확률)
    // ========================================================================

    /**
     * 왜 일부만 로그아웃하는가?
     * - 실제 사용자는 앱을 끄지 않고 백그라운드로 전환
     * - 로그아웃 API 부하가 상대적으로 낮음
     * - 세션 관리 리소스 사용 현실적으로 시뮬레이션
     */

    if (Math.random() < 0.5) {
        logout(accessToken);
    }

    // 메트릭 기록
    const scenarioDuration = new Date() - scenarioStart;
    fullScenarioDuration.add(scenarioDuration);
    scenarioFailRate.add(!scenarioSuccess);

    // 최소 대기 후 다음 반복
    sleep(0.2);
}

// ============================================================================
// 라이프사이클 훅
// ============================================================================

export function setup() {
    console.log('========================================');
    console.log('⚡ Spike Test Started');
    console.log('========================================');
    console.log(`Target: ${__ENV.K6_BASE_URL || 'http://localhost:8080'}`);
    console.log(`Peak VUs: 500`);
    console.log(`Duration: ~9 minutes`);
    console.log('');
    console.log('📈 Traffic Pattern:');
    console.log('   10 VU → 500 VU (10s) → 10 VU → 500 VU → 0 VU');
    console.log('');
    console.log('⚠️  This test simulates sudden traffic spikes!');
    console.log('');

    // 서버 헬스체크
    const isHealthy = healthCheck();
    if (!isHealthy) {
        throw new Error('Server health check failed');
    }

    return {
        startTime: new Date().toISOString(),
        testType: 'spike',
    };
}

export function teardown(data) {
    console.log('');
    console.log('========================================');
    console.log('✅ Spike Test Completed');
    console.log('========================================');
    console.log(`Test Type: ${data.testType}`);
    console.log(`Started: ${data.startTime}`);
    console.log(`Finished: ${new Date().toISOString()}`);
    console.log('');
    console.log('Key Questions to Answer:');
    console.log('- How quickly did the system react to the spike?');
    console.log('- What was the error rate during peak?');
    console.log('- How long did it take to recover?');
    console.log('- Did auto-scaling trigger (if configured)?');
    console.log('- Were existing users affected during the spike?');
}

export function handleSummary(data) {
    return createReportOutput(data, 'spike-test');
}
