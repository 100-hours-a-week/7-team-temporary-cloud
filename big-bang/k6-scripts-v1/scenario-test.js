/**
 * K6 시나리오 기반 테스트 (Scenario-Based Test)
 *
 * ============================================================================
 * 시나리오 기반 테스트란?
 * ============================================================================
 *
 * 여러 사용자 유형의 행동 패턴을 동시에 시뮬레이션하는 테스트입니다.
 *
 * 왜 필요한가?
 * 1. 실제 서비스 트래픽 패턴 반영
 *    - 신규 사용자 vs 기존 사용자
 *    - 읽기 중심 사용자 vs 쓰기 중심 사용자
 *    - 파워 유저 vs 일반 유저
 *
 * 2. 트래픽 믹스 최적화
 *    - API별로 다른 부하 패턴 적용
 *    - 실제 사용 비율에 맞는 테스트
 *
 * 3. 리소스 경합 시뮬레이션
 *    - 다양한 작업이 동시에 실행될 때의 성능
 *    - DB 락 경합, 캐시 경합 등 발견
 *
 * 실행 방법:
 * k6 run scenario-test.js
 */

import { group, sleep } from 'k6';
import {
    randomString,
    getCurrentTime,
    getTimeAfterMinutes,
} from './config.js';
import {
    logout,
    signup,
    getProfile,
    searchUsers,
    createSchedule,
    getSchedules,
    getSchedulesByDate,
    getDayPlanId,
    updateScheduleStatus,
    deleteSchedule,
    aiScheduleArrangement,
    getNotifications,
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
     * 시나리오 정의
     *
     * 각 시나리오는 독립적으로 실행되며 서로 다른 사용자 패턴을 시뮬레이션합니다.
     *
     * 왜 이런 시나리오들인가?
     *
     * 1. new_users (신규 사용자)
     *    - 회원가입 + 초기 설정
     *    - 상대적으로 적은 비율 (전체의 10%)
     *    - DB 쓰기 집중
     *
     * 2. returning_users (재방문 사용자)
     *    - 로그인 + 스케줄 조회
     *    - 가장 많은 비율 (전체의 60%)
     *    - 읽기 중심
     *
     * 3. active_users (활성 사용자)
     *    - 스케줄 CRUD 전체 수행
     *    - 중간 비율 (전체의 25%)
     *    - 읽기/쓰기 혼합
     *
     * 4. power_users (파워 유저)
     *    - AI 배치 등 고급 기능 사용
     *    - 적은 비율 (전체의 5%)
     *    - 리소스 집약적
     */
    scenarios: {
        // 신규 사용자: 회원가입 중심
        new_users: {
            executor: 'ramping-vus',
            exec: 'newUserScenario',
            startVUs: 0,
            stages: [
                { duration: '2m', target: 5 },
                { duration: '5m', target: 10 },
                { duration: '2m', target: 5 },
                { duration: '1m', target: 0 },
            ],
            tags: { scenario: 'new_users' },
        },

        // 재방문 사용자: 조회 중심
        returning_users: {
            executor: 'ramping-vus',
            exec: 'returningUserScenario',
            startVUs: 0,
            stages: [
                { duration: '2m', target: 30 },
                { duration: '5m', target: 60 },
                { duration: '2m', target: 30 },
                { duration: '1m', target: 0 },
            ],
            tags: { scenario: 'returning_users' },
        },

        // 활성 사용자: CRUD 수행
        active_users: {
            executor: 'ramping-vus',
            exec: 'activeUserScenario',
            startVUs: 0,
            stages: [
                { duration: '2m', target: 15 },
                { duration: '5m', target: 25 },
                { duration: '2m', target: 15 },
                { duration: '1m', target: 0 },
            ],
            tags: { scenario: 'active_users' },
        },

        // 파워 유저: AI 기능 사용
        power_users: {
            executor: 'ramping-vus',
            exec: 'powerUserScenario',
            startVUs: 0,
            stages: [
                { duration: '2m', target: 2 },
                { duration: '5m', target: 5 },
                { duration: '2m', target: 2 },
                { duration: '1m', target: 0 },
            ],
            tags: { scenario: 'power_users' },
        },
    },

    /**
     * 시나리오별 임계값
     */
    thresholds: {
        // 전체 메트릭
        http_req_duration: ['p(95)<3000'],
        http_req_failed: ['rate<0.05'],

        // 시나리오별 메트릭
        'http_req_duration{scenario:new_users}': ['p(95)<2000'],
        'http_req_duration{scenario:returning_users}': ['p(95)<1500'],
        'http_req_duration{scenario:active_users}': ['p(95)<2500'],
        'http_req_duration{scenario:power_users}': ['p(95)<10000'], // AI 포함

        // 시나리오별 실패율
        'http_req_failed{scenario:new_users}': ['rate<0.02'],
        'http_req_failed{scenario:returning_users}': ['rate<0.01'],
        'http_req_failed{scenario:active_users}': ['rate<0.03'],
        'http_req_failed{scenario:power_users}': ['rate<0.10'],
    },
};

// ============================================================================
// 시나리오 1: 신규 사용자
// ============================================================================

/**
 * 신규 사용자 시나리오
 *
 * 플로우: 회원가입 → 프로필 조회 → 첫 스케줄 생성
 *
 * 왜 이런 플로우인가?
 * - 회원가입은 DB 쓰기 + 해시 연산으로 리소스 집약적
 * - 신규 사용자는 보통 첫 일정을 바로 등록
 * - 이탈 방지를 위해 빠른 응답 필요
 */
export function newUserScenario() {
    const scenarioStart = new Date();
    let scenarioSuccess = true;

    group('new_user_flow', function () {
        // 1. 회원가입
        const signupResult = signup();
        if (!signupResult) {
            scenarioSuccess = false;
            return;
        }

        const { accessToken } = signupResult;

        thinkTime(2, 4);

        // 2. 프로필 확인
        getProfile(accessToken);

        thinkTime(1, 2);

        // 3. DayPlan ID 조회
        const scheduleInfo = getSchedulesByDate(accessToken);
        if (!scheduleInfo || !scheduleInfo.dayPlanId) {
            console.warn('newUserScenario: Failed to get dayPlanId');
            scenarioSuccess = false;
            logout(accessToken);
            return;
        }

        const dayPlanId = scheduleInfo.dayPlanId;

        thinkTime(1, 2);

        // 4. 첫 스케줄 생성
        const schedule = createSchedule(accessToken, dayPlanId, {
            type: 'FLEX',
            title: `My First Schedule ${randomString(4)}`,
            startAt: getCurrentTime(),
            endAt: getTimeAfterMinutes(60),
            estimatedTimeRange: 'HOUR_1_TO_2',
            focusLevel: 3,
            isUrgent: false,
        });

        thinkTime(2, 3);

        // 5. 로그아웃
        logout(accessToken);
    });

    fullScenarioDuration.add(new Date() - scenarioStart);
    scenarioFailRate.add(!scenarioSuccess);

    sleep(3);
}

// ============================================================================
// 시나리오 2: 재방문 사용자
// ============================================================================

/**
 * 재방문 사용자 시나리오
 *
 * 플로우: 회원가입 → 스케줄 조회 → 알림 확인 → 로그아웃
 *
 * 왜 이런 플로우인가?
 * - 대부분의 사용자는 앱을 열어 일정 확인만 함
 * - 읽기 중심 작업으로 캐시 효율성 측정에 적합
 * - 가장 흔한 사용 패턴
 */
export function returningUserScenario() {
    const scenarioStart = new Date();
    let scenarioSuccess = true;

    group('returning_user_flow', function () {
        // 1. 회원가입
        const signupResult = signup();
        if (!signupResult) {
            scenarioSuccess = false;
            return;
        }

        const { accessToken } = signupResult;

        thinkTime(1, 2);

        // 2. 프로필 로드
        getProfile(accessToken);

        thinkTime(1, 2);

        // 3. 오늘 스케줄 조회
        getSchedulesByDate(accessToken);

        thinkTime(2, 4);

        // 4. 알림 확인
        getNotifications(accessToken);

        thinkTime(1, 2);

        // 5. 로그아웃
        logout(accessToken);
    });

    fullScenarioDuration.add(new Date() - scenarioStart);
    scenarioFailRate.add(!scenarioSuccess);

    sleep(2);
}

// ============================================================================
// 시나리오 3: 활성 사용자
// ============================================================================

/**
 * 활성 사용자 시나리오
 *
 * 플로우: 회원가입 → 스케줄 CRUD → 사용자 검색 → 로그아웃
 *
 * 왜 이런 플로우인가?
 * - 앱을 적극적으로 사용하는 유저
 * - 읽기/쓰기 혼합으로 실제 트랜잭션 패턴 반영
 * - DB 락 경합 가능성 테스트
 */
export function activeUserScenario() {
    const scenarioStart = new Date();
    let scenarioSuccess = true;

    group('active_user_flow', function () {
        // 1. 회원가입
        const signupResult = signup();
        if (!signupResult) {
            scenarioSuccess = false;
            return;
        }

        const { accessToken } = signupResult;

        thinkTime(1, 2);

        // 2. 프로필 조회
        getProfile(accessToken);

        // 3. 스케줄 조회 + DayPlan ID 추출
        const scheduleInfo = getSchedulesByDate(accessToken);
        if (!scheduleInfo || !scheduleInfo.dayPlanId) {
            console.warn('activeUserScenario: Failed to get dayPlanId');
            scenarioSuccess = false;
            logout(accessToken);
            return;
        }

        const dayPlanId = scheduleInfo.dayPlanId;

        thinkTime(2, 3);

        // 4. 새 스케줄 생성
        const schedule = createSchedule(accessToken, dayPlanId, {
            type: 'FLEX',
            title: `Active User Task ${randomString(4)}`,
            startAt: getCurrentTime(),
            endAt: getTimeAfterMinutes(45),
            estimatedTimeRange: 'MINUTE_30_TO_60',
            focusLevel: 4,
            isUrgent: Math.random() < 0.3,
        });

        thinkTime(1, 2);

        // 5. 스케줄 목록 확인
        getSchedules(accessToken, dayPlanId);

        thinkTime(2, 3);

        // 6. 스케줄 상태 변경
        if (schedule && schedule.scheduleId) {
            updateScheduleStatus(accessToken, schedule.scheduleId, 'DONE');

            thinkTime(1, 2);

            // 7. 스케줄 삭제
            deleteSchedule(accessToken, schedule.scheduleId);
        }

        thinkTime(1, 2);

        // 8. 사용자 검색
        searchUsers(accessToken, 'User', 1, 10);

        thinkTime(1, 2);

        // 9. 로그아웃
        logout(accessToken);
    });

    fullScenarioDuration.add(new Date() - scenarioStart);
    scenarioFailRate.add(!scenarioSuccess);

    sleep(2);
}

// ============================================================================
// 시나리오 4: 파워 유저
// ============================================================================

/**
 * 파워 유저 시나리오
 *
 * 플로우: 회원가입 → 다수 스케줄 생성 → AI 배치 → 결과 확인
 *
 * 왜 이런 플로우인가?
 * - AI 기능은 외부 서비스 호출로 가장 무거운 작업
 * - 파워 유저는 많은 일정을 한 번에 관리
 * - 시스템의 최대 부하 상황 시뮬레이션
 */
export function powerUserScenario() {
    const scenarioStart = new Date();
    let scenarioSuccess = true;

    group('power_user_flow', function () {
        // 1. 회원가입
        const signupResult = signup();
        if (!signupResult) {
            scenarioSuccess = false;
            return;
        }

        const { accessToken } = signupResult;

        thinkTime(1, 2);

        // 2. 프로필 조회
        getProfile(accessToken);

        // 3. 스케줄 조회 + DayPlan ID 추출
        const scheduleInfo = getSchedulesByDate(accessToken);
        if (!scheduleInfo || !scheduleInfo.dayPlanId) {
            console.warn('powerUserScenario: Failed to get dayPlanId');
            scenarioSuccess = false;
            logout(accessToken);
            return;
        }

        const dayPlanId = scheduleInfo.dayPlanId;

        thinkTime(2, 3);

        // 4. 다수의 스케줄 생성 (3-5개)
        const scheduleCount = Math.floor(Math.random() * 3) + 3;
        const createdSchedules = [];

        for (let i = 0; i < scheduleCount; i++) {
            const schedule = createSchedule(accessToken, dayPlanId, {
                type: 'FLEX',
                title: `Power Task ${i + 1} ${randomString(3)}`,
                startAt: getTimeAfterMinutes(i * 30),
                endAt: getTimeAfterMinutes((i + 1) * 30),
                estimatedTimeRange: 'MINUTE_30_TO_60',
                focusLevel: Math.floor(Math.random() * 5) + 1,
                isUrgent: Math.random() < 0.2,
            });

            if (schedule) {
                createdSchedules.push(schedule);
            }

            thinkTime(0.5, 1);
        }

        thinkTime(2, 3);

        // 5. AI 스케줄 배치 요청
        // (이 API는 외부 AI 서비스 호출로 응답 시간이 김)
        aiScheduleArrangement(accessToken, dayPlanId);

        thinkTime(3, 5);

        // 6. 결과 확인
        getSchedules(accessToken, dayPlanId);

        thinkTime(2, 3);

        // 7. 정리 (생성한 스케줄 삭제)
        for (const schedule of createdSchedules) {
            if (schedule && schedule.scheduleId) {
                deleteSchedule(accessToken, schedule.scheduleId);
                thinkTime(0.3, 0.5);
            }
        }

        // 8. 로그아웃
        logout(accessToken);
    });

    fullScenarioDuration.add(new Date() - scenarioStart);
    scenarioFailRate.add(!scenarioSuccess);

    sleep(5);
}

// ============================================================================
// 라이프사이클 훅
// ============================================================================

export function setup() {
    console.log('========================================');
    console.log('🎭 Scenario-Based Test Started');
    console.log('========================================');
    console.log(`Target: ${__ENV.K6_BASE_URL || 'http://localhost:8080'}`);
    console.log(`Duration: ~10 minutes`);
    console.log('');
    console.log('📋 Active Scenarios:');
    console.log('   - new_users: 10% (signup flow)');
    console.log('   - returning_users: 60% (signup + read-heavy)');
    console.log('   - active_users: 25% (signup + CRUD mix)');
    console.log('   - power_users: 5% (signup + AI features)');
    console.log('');
    console.log('📊 Peak VUs per scenario:');
    console.log('   - new_users: 10 VU');
    console.log('   - returning_users: 60 VU');
    console.log('   - active_users: 25 VU');
    console.log('   - power_users: 5 VU');
    console.log('   - Total: 100 VU');
    console.log('');

    // 서버 헬스체크
    const isHealthy = healthCheck();
    if (!isHealthy) {
        throw new Error('Server health check failed');
    }

    return {
        startTime: new Date().toISOString(),
        testType: 'scenario',
    };
}

export function teardown(data) {
    console.log('');
    console.log('========================================');
    console.log('✅ Scenario-Based Test Completed');
    console.log('========================================');
    console.log(`Test Type: ${data.testType}`);
    console.log(`Started: ${data.startTime}`);
    console.log(`Finished: ${new Date().toISOString()}`);
    console.log('');
    console.log('📈 Compare scenario metrics to identify:');
    console.log('   - Which user type causes most load?');
    console.log('   - Is write/read ratio balanced?');
    console.log('   - Does AI feature need rate limiting?');
}
