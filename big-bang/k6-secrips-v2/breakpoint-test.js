/**
 * K6 브레이크포인트 테스트 (Breakpoint Test)
 *
 * ============================================================================
 * 브레이크포인트 테스트란?
 * ============================================================================
 *
 * 시스템이 완전히 실패하는 지점(Breaking Point)을 찾기 위해
 * 지속적으로 부하를 증가시키는 테스트입니다.
 *
 * 스트레스 테스트와의 차이점:
 * - 스트레스 테스트: 예상 한계까지 테스트 후 복구 확인
 * - 브레이크포인트 테스트: 실제로 시스템이 죽을 때까지 부하 증가
 *
 * 왜 필요한가?
 * 1. 절대적 한계점 파악
 *    - 시스템이 처리할 수 있는 최대 동시 사용자 수
 *    - 초당 최대 처리량(RPS)
 *
 * 2. 장애 모드 분석
 *    - 어떤 컴포넌트가 먼저 실패하는지 (DB, 앱 서버, 메모리)
 *    - 실패 시 에러 메시지/로그 패턴
 *    - Graceful Degradation vs Catastrophic Failure
 *
 * 3. 안전 마진 계산
 *    - Breaking Point의 60-70%를 일반 운영 한계로 설정
 *    - 스케일링 트리거 임계값 결정
 *
 * ⚠️ 주의사항:
 * - 절대로 프로덕션에서 실행하지 마세요!
 * - 격리된 테스트 환경에서만 실행
 * - 테스트 후 시스템 재시작 필요할 수 있음
 * - DB 연결, 캐시 등 공유 리소스 영향 고려
 *
 * 실행 방법:
 * k6 run breakpoint-test.js
 */

import { group, sleep } from 'k6';
import {
    randomString,
    getCurrentTime,
    getTimeAfterMinutes,
} from './config.js';
import {
    signup,
    getProfile,
    createSchedule,
    getSchedulesByDate,
    getDayPlanId,
    deleteSchedule,
    healthCheck,
    fullScenarioDuration,
    scenarioFailRate,
} from './helpers.js';

// ============================================================================
// 테스트 설정
// ============================================================================

export const options = {
    /**
     * 브레이크포인트 테스트 단계 설정
     *
     * 지속적으로 증가하여 시스템 한계 도달:
     *
     * 단계별로 VU를 증가시키면서 언제 실패하는지 관찰
     * - 각 단계에서 1분간 안정화하여 해당 부하에서의 성능 측정
     * - 점진적 증가로 정확한 Breaking Point 식별
     *
     * 왜 이렇게 설정하는가?
     * - 50 VU씩 증가: 세밀한 Breaking Point 식별
     * - 1분 유지: 해당 부하에서 안정화 여부 확인
     * - 최대 1000 VU: 대부분의 서비스 한계 초과
     */
    stages: [
        { duration: '1m', target: 50 },
        { duration: '1m', target: 100 },
        { duration: '1m', target: 150 },
        { duration: '1m', target: 200 },
        { duration: '1m', target: 250 },
        { duration: '1m', target: 300 },
        { duration: '1m', target: 350 },
        { duration: '1m', target: 400 },
        { duration: '1m', target: 450 },
        { duration: '1m', target: 500 },
        { duration: '1m', target: 600 },
        { duration: '1m', target: 700 },
        { duration: '1m', target: 800 },
        { duration: '1m', target: 900 },
        { duration: '1m', target: 1000 },
        { duration: '2m', target: 0 }, // 복구 관찰
    ],

    /**
     * Graceful 종료 설정
     *
     * 브레이크포인트 테스트는 시스템이 과부하 상태일 수 있으므로
     * iteration 완료를 위해 더 긴 대기 시간 설정
     */
    gracefulStop: '60s',
    gracefulRampDown: '30s',

    /**
     * 브레이크포인트 테스트 임계값
     *
     * 임계값을 설정하지 않거나 매우 느슨하게 설정:
     * - 목적이 실패 지점을 찾는 것이므로 실패를 허용
     * - 단, 데이터 수집을 위해 기본 메트릭은 유지
     */
    thresholds: {
        // 매우 느슨한 임계값 - Breaking Point 찾기가 목적
        http_req_duration: ['p(95)<30000'], // 30초까지 허용
        http_req_failed: ['rate<0.50'],     // 50% 실패까지 허용
    },

    /**
     * 실패 시 중단하지 않음
     *
     * Breaking Point를 찾아야 하므로 테스트 계속 진행
     */
    noConnectionReuse: false,
    discardResponseBodies: true, // 메모리 절약
};

// ============================================================================
// 메인 테스트 시나리오
// ============================================================================

/**
 * 브레이크포인트 테스트 시나리오
 *
 * 최소한의 작업으로 최대 부하 생성:
 * - 가장 기본적인 작업만 수행
 * - Think Time 없음 (최대 RPS)
 * - 빠른 실패 시 즉시 다음 반복
 *
 * 왜 이런 플로우인가?
 * - 단순 플로우로 병목 지점 명확히 식별
 * - 복잡한 로직 없이 순수 시스템 성능 측정
 * - 최대 처리량 도달이 목적
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
        fullScenarioDuration.add(new Date() - scenarioStart);
        return; // 빠른 실패
    }

    // ========================================================================
    // 2. 핵심 작업만 수행 + DayPlan ID 조회
    // ========================================================================

    let dayPlanId = null;

    group('core_operations', function () {
        // 프로필 조회 (읽기)
        getProfile(accessToken);

        // 오늘 스케줄 조회 (읽기) + dayPlanId 추출
        const scheduleInfo = getSchedulesByDate(accessToken);
        if (scheduleInfo && scheduleInfo.dayPlanId) {
            dayPlanId = scheduleInfo.dayPlanId;
        }

        // 스케줄 생성 (쓰기) - 50% 확률, dayPlanId가 있을 때만
        if (dayPlanId && Math.random() < 0.5) {
            const scheduleData = {
                type: 'FLEX',
                title: `BP_${__VU}_${randomString(4)}`,
                startAt: getCurrentTime(),
                endAt: getTimeAfterMinutes(30),
                estimatedTimeRange: 'MINUTES_30_TO_60',
                focusLevel: 3,
                isUrgent: false,
            };

            const schedule = createSchedule(accessToken, dayPlanId, scheduleData);

            // 생성 성공 시 즉시 삭제 (DB 정리)
            if (schedule && schedule.scheduleId) {
                deleteSchedule(accessToken, schedule.scheduleId);
            }
        }
    });

    // 메트릭 기록
    fullScenarioDuration.add(new Date() - scenarioStart);
    scenarioFailRate.add(!scenarioSuccess);

    // Think Time 없음 - 최대 부하 생성
}

// ============================================================================
// 라이프사이클 훅
// ============================================================================

export function setup() {
    console.log('========================================');
    console.log('💥 Breakpoint Test Started');
    console.log('========================================');
    console.log(`Target: ${__ENV.K6_BASE_URL || 'http://localhost:8080'}`);
    console.log(`Max VUs: 1000`);
    console.log(`Duration: ~17 minutes`);
    console.log('');
    console.log('🎯 Goal: Find the Breaking Point!');
    console.log('');
    console.log('⚠️  WARNING:');
    console.log('   - This test WILL push the system to failure');
    console.log('   - NEVER run on production');
    console.log('   - System may need restart after test');
    console.log('');
    console.log('📊 Watch for:');
    console.log('   - Sudden response time increase');
    console.log('   - Error rate spike');
    console.log('   - Throughput plateau or drop');
    console.log('');

    // 서버 헬스체크
    const isHealthy = healthCheck();
    if (!isHealthy) {
        throw new Error('Server health check failed');
    }

    return {
        startTime: new Date().toISOString(),
        testType: 'breakpoint',
    };
}

export function teardown(data) {
    console.log('');
    console.log('========================================');
    console.log('✅ Breakpoint Test Completed');
    console.log('========================================');
    console.log(`Test Type: ${data.testType}`);
    console.log(`Started: ${data.startTime}`);
    console.log(`Finished: ${new Date().toISOString()}`);
    console.log('');
    console.log('📈 Analysis Guide:');
    console.log('');
    console.log('1. Identify the Breaking Point:');
    console.log('   - At what VU count did errors spike above 10%?');
    console.log('   - When did response time exceed acceptable limits?');
    console.log('');
    console.log('2. Determine Safe Operating Limit:');
    console.log('   - Set max capacity at 60-70% of Breaking Point');
    console.log('   - Example: If BP = 500 VU, safe limit = 300-350 VU');
    console.log('');
    console.log('3. Review Failure Mode:');
    console.log('   - Which component failed first?');
    console.log('   - Was it graceful degradation or catastrophic?');
    console.log('   - Check server logs for root cause');
    console.log('');
    console.log('4. Document Results:');
    console.log('   - Max VUs before degradation: ??? VU');
    console.log('   - Max RPS achieved: ??? req/s');
    console.log('   - First error type: ???');
}
