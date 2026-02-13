/**
 * K6 로드 테스트 2 (운영 서버용)
 *
 * ============================================================================
 * 기존 load-test.js와의 차이점
 * ============================================================================
 *
 * 1. 계정 생성: setup 단계에서 한 번만 생성
 * 2. 반복 작업: 로그인 → 스케줄 생성/삭제만 반복
 * 3. 운영 서버 부하 최소화: 불필요한 회원가입 제거
 *
 * 실행 방법:
 * k6 run load-test2.js
 * K6_BASE_URL=https://api.example.com k6 run load-test2.js
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
    login,
    logout,
    signupTestUser,
    getSchedulesByDate,
    createSchedule,
    getSchedules,
    deleteSchedule,
    healthCheck,
    thinkTime,
    createScheduleDuration,
    getSchedulesDuration,
    fullScenarioDuration,
    scenarioFailRate,
} from './helpers.js';

// ============================================================================
// 테스트 계정 설정
// ============================================================================

/**
 * 테스트 계정 수
 * VU 수보다 크거나 같아야 함
 */
const NUM_TEST_ACCOUNTS = 100;

/**
 * 테스트 계정 생성 함수
 * @param {number} index - 계정 인덱스
 * @returns {object} - { email, password, nickname }
 */
function generateTestAccount(index) {
    return {
        email: `loadtest_prod_${index}@test.com`,
        password: 'Test1234!',
        nickname: `LoadUser${index}`,
    };
}

// ============================================================================
// 테스트 설정
// ============================================================================

export const options = {
    stages: LOAD_TEST_STAGES,

    gracefulStop: '30s',
    gracefulRampDown: '30s',

    thresholds: {
        ...COMMON_THRESHOLDS,
        ...ENDPOINT_THRESHOLDS.auth_login,
        ...ENDPOINT_THRESHOLDS.schedule_create,
        ...ENDPOINT_THRESHOLDS.schedule_list,

        'create_schedule_duration': ['p(95)<1500', 'p(99)<3000'],
        'get_schedules_duration': ['p(95)<1000', 'p(99)<2000'],
        'full_scenario_duration': ['p(95)<8000', 'p(99)<12000'],
        'scenario_failures': ['rate<0.05'],
    },
};

// ============================================================================
// Setup: 테스트 계정 생성 (한 번만 실행)
// ============================================================================

export function setup() {
    console.log('========================================');
    console.log('Load Test 2 - Production Server');
    console.log('========================================');
    console.log('Phase 1: Health Check');

    // 서버 헬스체크
    const isHealthy = healthCheck();
    if (!isHealthy) {
        throw new Error('Server health check failed');
    }

    console.log('Health check passed');
    console.log('');
    console.log('Phase 2: Creating test accounts...');

    // 테스트 계정 생성
    const accounts = [];
    let successCount = 0;
    let existingCount = 0;

    for (let i = 0; i < NUM_TEST_ACCOUNTS; i++) {
        const account = generateTestAccount(i);
        const created = signupTestUser(account.email, account.password, account.nickname);

        if (created) {
            successCount++;
        }
        accounts.push(account);

        // Rate limiting 방지
        if (i % 10 === 9) {
            sleep(1);
        }
    }

    console.log('');
    console.log(`Account creation complete: ${successCount}/${NUM_TEST_ACCOUNTS}`);
    console.log('');
    console.log('Phase 3: Starting load test...');
    console.log('========================================');

    return {
        accounts: accounts,
        startTime: new Date().toISOString(),
        testType: 'load-production',
    };
}

// ============================================================================
// 메인 테스트 시나리오 (반복 실행)
// ============================================================================

/**
 * 메인 시나리오: 로그인 → 스케줄 생성/삭제 반복
 *
 * 매 iteration마다:
 * 1. 로그인 (이미 생성된 계정 사용)
 * 2. DayPlan ID 조회
 * 3. 스케줄 생성
 * 4. 스케줄 목록 조회
 * 5. 스케줄 삭제
 * 6. 로그아웃
 */
export default function (data) {
    const scenarioStart = new Date();
    let scenarioSuccess = true;

    // VU에 해당하는 계정 선택
    const accountIndex = (__VU - 1) % data.accounts.length;
    const account = data.accounts[accountIndex];

    // ========================================================================
    // Phase 1: 로그인
    // ========================================================================

    let accessToken = null;

    group('01_Login', function () {
        const loginResult = login(account.email, account.password);
        if (!loginResult) {
            console.warn(`VU ${__VU}: Login failed for ${account.email}`);
            scenarioSuccess = false;
            return;
        }
        accessToken = loginResult.accessToken;
    });

    if (!accessToken) {
        scenarioFailRate.add(true);
        return;
    }

    thinkTime(0.5, 1);

    // ========================================================================
    // Phase 2: DayPlan ID 조회
    // ========================================================================

    let dayPlanId = null;

    group('02_Get_DayPlan', function () {
        const scheduleInfo = getSchedulesByDate(accessToken);
        if (scheduleInfo && scheduleInfo.dayPlanId) {
            dayPlanId = scheduleInfo.dayPlanId;
        }
    });

    if (!dayPlanId) {
        console.warn(`VU ${__VU}: Failed to get dayPlanId`);
        scenarioFailRate.add(true);
        logout(accessToken);
        return;
    }

    thinkTime(0.5, 1);

    // ========================================================================
    // Phase 3: 스케줄 생성/삭제 반복
    // ========================================================================

    let createdSchedule = null;

    group('03_Schedule_Create', function () {
        const scheduleData = {
            type: 'FLEX',
            title: `Prod Test ${randomString(5)}`,
            startAt: getCurrentTime(),
            endAt: getTimeAfterMinutes(60),
            estimatedTimeRange: 'HOUR_1_TO_2',
            focusLevel: Math.floor(Math.random() * 5) + 1,
            isUrgent: false,
        };

        createdSchedule = createSchedule(accessToken, dayPlanId, scheduleData);

        if (!createdSchedule) {
            console.warn(`VU ${__VU}: Schedule creation failed`);
            scenarioSuccess = false;
        }
    });

    thinkTime(0.5, 1);

    // ========================================================================
    // Phase 4: 스케줄 목록 조회
    // ========================================================================

    group('04_Schedule_List', function () {
        getSchedules(accessToken, dayPlanId);
    });

    thinkTime(0.5, 1);

    // ========================================================================
    // Phase 5: 스케줄 삭제 (생성한 스케줄 정리)
    // ========================================================================

    group('05_Schedule_Delete', function () {
        if (createdSchedule && createdSchedule.scheduleId) {
            deleteSchedule(accessToken, createdSchedule.scheduleId);
        }
    });

    thinkTime(0.3, 0.5);

    // ========================================================================
    // Phase 6: 로그아웃
    // ========================================================================

    group('06_Logout', function () {
        logout(accessToken);
    });

    // ========================================================================
    // 시나리오 완료 메트릭 기록
    // ========================================================================

    const scenarioDuration = new Date() - scenarioStart;
    fullScenarioDuration.add(scenarioDuration);
    scenarioFailRate.add(!scenarioSuccess);

    // 다음 반복 전 짧은 대기
    sleep(0.5);
}

// ============================================================================
// Teardown: 정리
// ============================================================================

export function teardown(data) {
    console.log('');
    console.log('========================================');
    console.log('Load Test 2 Completed');
    console.log('========================================');
    console.log(`Test Type: ${data.testType}`);
    console.log(`Started: ${data.startTime}`);
    console.log(`Finished: ${new Date().toISOString()}`);
    console.log(`Accounts Used: ${data.accounts.length}`);
    console.log('');
    console.log('Key Metrics:');
    console.log('- login_duration: Authentication performance');
    console.log('- create_schedule_duration: Schedule creation');
    console.log('- get_schedules_duration: Schedule listing');
    console.log('- scenario_failures: End-to-end success rate');
}

export function handleSummary(data) {
    return createReportOutput(data, 'load-test2');
}
