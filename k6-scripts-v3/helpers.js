/**
 * K6 부하 테스트 헬퍼 함수 모음
 *
 * 왜 필요한가?
 * - API 호출 로직을 재사용 가능한 함수로 캡슐화
 * - 테스트 스크립트의 가독성 향상
 * - 응답 검증 로직 중앙 집중화
 * - 에러 처리 표준화
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { BASE_URL, DEFAULT_HEADERS, TIMEOUTS, randomEmail, randomNickname, randomString, getTodayDate, getCurrentTime, getTimeAfterMinutes } from './config.js';

// ============================================================================
// 커스텀 메트릭 정의
// ============================================================================

/**
 * 커스텀 메트릭을 정의하는 이유:
 *
 * 1. 비즈니스 로직별 성능 측정
 *    - 단순 HTTP 메트릭만으로는 어떤 기능이 느린지 파악 어려움
 *    - 로그인, 스케줄 생성 등 기능별 응답 시간 추적
 *
 * 2. SLO(Service Level Objective) 모니터링
 *    - 각 API별 목표 성능 달성 여부 확인
 *    - 운영 환경 모니터링 지표와 일치
 *
 * 3. 장애 원인 분석
 *    - 특정 기능에서만 성능 저하 발생 시 빠른 식별
 */

// 인증 관련 메트릭
export const loginDuration = new Trend('login_duration', true);
export const loginFailRate = new Rate('login_failures');
export const refreshTokenDuration = new Trend('refresh_token_duration', true);
export const signupDuration = new Trend('signup_duration', true);

// 사용자 관련 메트릭
export const getProfileDuration = new Trend('get_profile_duration', true);
export const searchUsersDuration = new Trend('search_users_duration', true);

// 스케줄 관련 메트릭 - 핵심 비즈니스 로직
export const createScheduleDuration = new Trend('create_schedule_duration', true);
export const getSchedulesDuration = new Trend('get_schedules_duration', true);
export const updateScheduleDuration = new Trend('update_schedule_duration', true);
export const deleteScheduleDuration = new Trend('delete_schedule_duration', true);
export const aiArrangementDuration = new Trend('ai_arrangement_duration', true);

// 전체 시나리오 메트릭
export const fullScenarioDuration = new Trend('full_scenario_duration', true);
export const scenarioFailRate = new Rate('scenario_failures');

// ============================================================================
// 인증 관련 함수
// ============================================================================

/**
 * 사용자 로그인
 *
 * 왜 이 함수가 중요한가?
 * - 모든 인증된 API 호출의 시작점
 * - JWT 토큰 발급 성능은 전체 사용자 경험에 직접적 영향
 * - 로그인 실패는 서비스 전체 접근 불가를 의미
 *
 * @param {string} email - 사용자 이메일
 * @param {string} password - 비밀번호
 * @returns {object} - { accessToken, cookies } 또는 null (실패 시)
 */
export function login(email, password) {
    const payload = JSON.stringify({
        email: email,
        password: password,
    });

    const params = {
        headers: DEFAULT_HEADERS,
        tags: { name: 'login' },
        timeout: TIMEOUTS.default,
    };

    const response = http.post(`${BASE_URL}/token`, payload, params);

    // 메트릭 기록
    loginDuration.add(response.timings.duration);

    // 응답 검증
    const success = check(response, {
        'login: status is 200': (r) => r.status === 200,
        'login: has access token': (r) => {
            try {
                const body = JSON.parse(r.body);
                return body.data && body.data.accessToken;
            } catch (e) {
                return false;
            }
        },
        'login: response time < 500ms': (r) => r.timings.duration < 500,
    });

    loginFailRate.add(!success);

    if (!success) {
        console.error(`Login failed for ${email}: ${response.status} - ${response.body}`);
        return null;
    }

    const body = JSON.parse(response.body);
    return {
        accessToken: body.data.accessToken,
        cookies: response.cookies,
    };
}

/**
 * 토큰 갱신
 *
 * 왜 이 함수가 중요한가?
 * - Access Token 만료 시 사용자 세션 유지를 위해 필수
 * - 백그라운드에서 자동으로 호출되므로 빠른 응답 필요
 * - 실패 시 사용자가 재로그인해야 하므로 UX에 큰 영향
 *
 * @param {object} cookies - 로그인 시 받은 쿠키 (refreshToken 포함)
 * @returns {object} - 새로운 { accessToken, cookies } 또는 null
 */
export function refreshToken(cookies) {
    const params = {
        headers: DEFAULT_HEADERS,
        cookies: cookies,
        tags: { name: 'refresh_token' },
        timeout: TIMEOUTS.default,
    };

    const response = http.put(`${BASE_URL}/token`, null, params);

    refreshTokenDuration.add(response.timings.duration);

    const success = check(response, {
        'refresh: status is 200': (r) => r.status === 200,
        'refresh: has new access token': (r) => {
            try {
                const body = JSON.parse(r.body);
                return body.data && body.data.accessToken;
            } catch (e) {
                return false;
            }
        },
        'refresh: response time < 300ms': (r) => r.timings.duration < 300,
    });

    if (!success) {
        console.error(`Token refresh failed: ${response.status}`);
        return null;
    }

    const body = JSON.parse(response.body);
    return {
        accessToken: body.data.accessToken,
        cookies: response.cookies,
    };
}

/**
 * 로그아웃
 *
 * @param {string} accessToken - JWT 액세스 토큰
 */
export function logout(accessToken) {
    const params = {
        headers: {
            ...DEFAULT_HEADERS,
            'Authorization': `Bearer ${accessToken}`,
        },
        tags: { name: 'logout' },
        timeout: TIMEOUTS.default,
    };

    const response = http.del(`${BASE_URL}/token`, null, params);

    check(response, {
        'logout: status is 204': (r) => r.status === 204,
    });
}

/**
 * 회원가입
 *
 * 왜 이 함수가 중요한가?
 * - 신규 사용자 유입의 첫 관문
 * - 회원가입 실패/지연은 사용자 이탈로 직결
 * - DB 쓰기, 비밀번호 해싱 등 리소스 집약적 작업 포함
 *
 * @returns {object} - { userId, accessToken, cookies } 또는 null
 */
export function signup() {
    const payload = JSON.stringify({
        email: randomEmail(),
        password: 'Test1234!',
        nickname: "testUser",
        gender: 'MALE',
        birth: '1990.01.01',
        focusTimeZone: 'MORNING',
        dayEndTime: '23:00',
        profileImageKey: null,
        terms: [{
            "termsId": 1,
            "isAgreed": true
        },{
            "termsId": 2,
            "isAgreed": true
        },{
            "termsId": 3,
            "isAgreed": true
        }], // 필수 약관 동의
    });

    const params = {
        headers: DEFAULT_HEADERS,
        tags: { name: 'signup' },
        timeout: TIMEOUTS.default,
    };

    const response = http.post(`${BASE_URL}/users`, payload, params);

    signupDuration.add(response.timings.duration);

    const success = check(response, {
        'signup: status is 201': (r) => r.status === 200,
        'signup: has user id': (r) => {
            try {
                const body = JSON.parse(r.body);
                return body.data && body.data.userId;
            } catch (e) {
                return false;
            }
        },
    });

    if (!success) {
        console.error(`Signup failed: ${response.status} - ${response.body}`);
        return null;
    }

    const body = JSON.parse(response.body);
    return {
        userId: body.data.userId,
        accessToken: body.data.accessToken,
        cookies: response.cookies,
    };
}

/**
 * 특정 credentials로 회원가입 (테스트 사용자 생성용)
 *
 * setup 단계에서 테스트 사용자를 미리 생성할 때 사용
 * 이미 존재하는 사용자라면 실패하지만 테스트는 계속 진행
 *
 * @param {string} email - 이메일
 * @param {string} password - 비밀번호
 * @param {string} nickname - 닉네임
 * @returns {boolean} - 성공 여부
 */
export function signupTestUser(email, password, nickname) {
    const payload = JSON.stringify({
        email: email,
        password: password,
        nickname: nickname,
        gender: 'MALE',
        birth: '1990.01.01',
        focusTimeZone: 'MORNING',
        dayEndTime: '23:00',
        profileImageKey: null,
        terms: [
            { termsId: 1, isAgreed: true },
            { termsId: 2, isAgreed: true },
            { termsId: 3, isAgreed: true },
        ],
    });

    const params = {
        headers: DEFAULT_HEADERS,
        tags: { name: 'setup_signup' },
        timeout: TIMEOUTS.default,
    };

    const response = http.post(`${BASE_URL}/users`, payload, params);

    if (response.status === 200) {
        console.log(`✅ Test user created: ${email}`);
        return true;
    } else if (response.status === 409 || response.body.includes('DUPLICATE')) {
        console.log(`ℹ️ Test user already exists: ${email}`);
        return true; // 이미 존재해도 OK
    } else {
        console.warn(`⚠️ Failed to create test user ${email}: ${response.status} - ${response.body}`);
        return false;
    }
}

// ============================================================================
// 사용자 관련 함수
// ============================================================================

/**
 * 사용자 프로필 조회
 *
 * 왜 이 함수가 중요한가?
 * - 앱 실행 시 매번 호출되는 API
 * - 사용자별 설정, 권한 정보 등을 가져옴
 * - 캐싱 효율성 측정에 중요
 *
 * @param {string} accessToken - JWT 액세스 토큰
 * @returns {object} - 사용자 프로필 데이터 또는 null
 */
export function getProfile(accessToken) {
    const params = {
        headers: {
            ...DEFAULT_HEADERS,
            'Authorization': `Bearer ${accessToken}`,
        },
        tags: { name: 'get_profile' },
        timeout: TIMEOUTS.default,
    };

    const response = http.get(`${BASE_URL}/users`, params);

    getProfileDuration.add(response.timings.duration);

    const success = check(response, {
        'get_profile: status is 200': (r) => r.status === 200,
        'get_profile: has user data': (r) => {
            try {
                const body = JSON.parse(r.body);
                return body.data && body.data.email;
            } catch (e) {
                return false;
            }
        },
        'get_profile: response time < 500ms': (r) => r.timings.duration < 500,
    });

    if (!success) {
        return null;
    }

    return JSON.parse(response.body).data;
}

/**
 * 사용자 닉네임 검색
 *
 * 왜 이 함수가 중요한가?
 * - 친구 추가, 멘션 등 소셜 기능의 기반
 * - LIKE 쿼리 사용으로 DB 부하 높음
 * - 페이지네이션 최적화 필요
 *
 * @param {string} accessToken - JWT 액세스 토큰
 * @param {string} nickname - 검색할 닉네임
 * @param {number} page - 페이지 번호
 * @param {number} size - 페이지 크기
 */
export function searchUsers(accessToken, nickname, page = 1, size = 10) {
    const params = {
        headers: {
            ...DEFAULT_HEADERS,
            'Authorization': `Bearer ${accessToken}`,
        },
        tags: { name: 'search_users' },
        timeout: TIMEOUTS.default,
    };

    const response = http.get(
        `${BASE_URL}/users/nickname?nickname=${encodeURIComponent(nickname)}&page=${page}&size=${size}`,
        params
    );

    searchUsersDuration.add(response.timings.duration);

    check(response, {
        'search_users: status is 200': (r) => r.status === 200,
        'search_users: response time < 1000ms': (r) => r.timings.duration < 1000,
    });

    return response;
}

// ============================================================================
// 스케줄 관련 함수 - 핵심 비즈니스 로직
// ============================================================================

/**
 * 스케줄 생성
 *
 * 왜 이 함수가 가장 중요한가?
 * - 앱의 핵심 기능 (일정 관리)
 * - DB 쓰기 + 이벤트 발행 + 알림 처리 등 복잡한 로직
 * - 동시성 이슈 발생 가능성 높음 (같은 시간대 중복 등)
 *
 * @param {string} accessToken - JWT 액세스 토큰
 * @param {number} dayPlanId - DayPlan ID
 * @param {object} scheduleData - 스케줄 데이터 (optional)
 * @returns {object} - 생성된 스케줄 정보 또는 null
 */
export function createSchedule(accessToken, dayPlanId, scheduleData = null) {
    const defaultData = {
        type: 'FLEX',
        title: `Load Test Schedule ${randomString(5)}`,
        startAt: getCurrentTime(),
        endAt: getTimeAfterMinutes(60),
        estimatedTimeRange: 'HOUR_1_TO_2',
        focusLevel: Math.floor(Math.random() * 5) + 1, // 1-5
        isUrgent: false,
    };

    const payload = JSON.stringify(scheduleData || defaultData);

    const params = {
        headers: {
            ...DEFAULT_HEADERS,
            'Authorization': `Bearer ${accessToken}`,
        },
        tags: { name: 'create_schedule' },
        timeout: TIMEOUTS.default,
    };

    const response = http.post(
        `${BASE_URL}/day-plan/${dayPlanId}/schedule`,
        payload,
        params
    );

    createScheduleDuration.add(response.timings.duration);

    const success = check(response, {
        'create_schedule: status is 201': (r) => r.status === 200,
        'create_schedule: has schedule id': (r) => {
            try {
                const body = JSON.parse(r.body);
                return body.data && body.data.scheduleId;
            } catch (e) {
                return false;
            }
        },
        'create_schedule: response time < 1500ms': (r) => r.timings.duration < 1500,
    });

    if (!success) {
        console.error(`Create schedule failed: ${response.status} - ${response.body}`);
        return null;
    }

    return JSON.parse(response.body).data;
}

/**
 * 스케줄 목록 조회
 *
 * 왜 이 함수가 중요한가?
 * - 메인 화면에서 가장 자주 호출되는 API
 * - 페이지네이션, 정렬, 필터링 등 복잡한 쿼리
 * - N+1 쿼리 문제 발생 가능성
 *
 * @param {string} accessToken - JWT 액세스 토큰
 * @param {number} dayPlanId - DayPlan ID
 * @param {number} page - 페이지 번호
 * @param {number} size - 페이지 크기
 */
export function getSchedules(accessToken, dayPlanId, page = 1, size = 10) {
    const targetDate = getTodayDate();

    const params = {
        headers: {
            ...DEFAULT_HEADERS,
            'Authorization': `Bearer ${accessToken}`,
        },
        tags: { name: 'get_schedules' },
        timeout: TIMEOUTS.default,
    };

    const response = http.get(
        `${BASE_URL}/day-plan/schedule?date=${targetDate}&page=${page}&size=${size}`,
        params
    );

    getSchedulesDuration.add(response.timings.duration);

    check(response, {
        'get_schedules: status is 200': (r) => r.status === 200,
        'get_schedules: response time < 1000ms': (r) => r.timings.duration < 1000,
    });

    return response;
}

/**
 * 날짜별 스케줄 조회 및 DayPlan 정보 반환
 *
 * @param {string} accessToken - JWT 액세스 토큰
 * @param {string} date - YYYY-MM-DD 형식의 날짜
 * @returns {object} - { dayPlanId, response } 또는 null
 */
export function getSchedulesByDate(accessToken, date = null) {
    const targetDate = date || getTodayDate();

    const params = {
        headers: {
            ...DEFAULT_HEADERS,
            'Authorization': `Bearer ${accessToken}`,
        },
        tags: { name: 'get_schedules_by_date' },
        timeout: TIMEOUTS.default,
    };

    const response = http.get(
        `${BASE_URL}/day-plan/schedule?date=${targetDate}&page=1&size=10`,
        params
    );

    getSchedulesDuration.add(response.timings.duration);

    const success = check(response, {
        'get_schedules_by_date: status is 200': (r) => r.status === 200,
        'get_schedules_by_date: has dayPlanId': (r) => {
            try {
                const body = JSON.parse(r.body);
                return body.data && body.data.dayPlanId;
            } catch (e) {
                return false;
            }
        },
    });

    if (!success) {
        console.warn(`[DEBUG] getSchedulesByDate failed - status: ${response.status}, body: ${response.body}`);
        return null;
    }

    const body = JSON.parse(response.body);
    return {
        dayPlanId: body.data.dayPlanId,
        schedules: body.data.content || [],
        response: response,
    };
}

/**
 * DayPlan ID만 조회하는 간편 함수
 *
 * 왜 이 함수가 필요한가?
 * - 스케줄 생성 전 반드시 dayPlanId가 필요
 * - 하드코딩된 ID 대신 동적으로 조회
 * - 회원가입 직후 dayPlan이 자동 생성되므로 이를 조회
 *
 * @param {string} accessToken - JWT 액세스 토큰
 * @param {string} date - YYYY-MM-DD 형식의 날짜 (기본: 오늘)
 * @returns {number} - dayPlanId 또는 null
 */
export function getDayPlanId(accessToken, date = null) {
    const result = getSchedulesByDate(accessToken, date);
    if (!result) {
        return null;
    }
    return result.dayPlanId;
}

/**
 * 스케줄 수정
 *
 * @param {string} accessToken - JWT 액세스 토큰
 * @param {number} scheduleId - 스케줄 ID
 * @param {object} updateData - 수정할 데이터
 */
export function updateSchedule(accessToken, scheduleId, updateData) {
    const payload = JSON.stringify(updateData);

    const params = {
        headers: {
            ...DEFAULT_HEADERS,
            'Authorization': `Bearer ${accessToken}`,
        },
        tags: { name: 'update_schedule' },
        timeout: TIMEOUTS.default,
    };

    const response = http.put(
        `${BASE_URL}/schedule/${scheduleId}`,
        payload,
        params
    );

    updateScheduleDuration.add(response.timings.duration);

    check(response, {
        'update_schedule: status is 204': (r) => r.status === 204,
        'update_schedule: response time < 1000ms': (r) => r.timings.duration < 1000,
    });

    return response;
}

/**
 * 스케줄 삭제
 *
 * @param {string} accessToken - JWT 액세스 토큰
 * @param {number} scheduleId - 스케줄 ID
 */
export function deleteSchedule(accessToken, scheduleId) {
    const params = {
        headers: {
            ...DEFAULT_HEADERS,
            'Authorization': `Bearer ${accessToken}`,
        },
        tags: { name: 'delete_schedule' },
        timeout: TIMEOUTS.default,
    };

    const response = http.del(
        `${BASE_URL}/schedule/${scheduleId}`,
        null,
        params
    );

    deleteScheduleDuration.add(response.timings.duration);

    check(response, {
        'delete_schedule: status is 204': (r) => r.status === 204,
    });

    return response;
}

/**
 * 스케줄 상태 변경
 *
 * 왜 이 함수가 중요한가?
 * - 사용자가 일정을 완료/미완료 처리할 때 호출
 * - 상태 변경에 따른 이벤트 발행 (알림, 통계 등)
 *
 * @param {string} accessToken - JWT 액세스 토큰
 * @param {number} scheduleId - 스케줄 ID
 * @param {string} status - 변경할 상태 (COMPLETED, PENDING 등)
 */
export function updateScheduleStatus(accessToken, scheduleId, status) {
    const payload = JSON.stringify({ status: status });

    const params = {
        headers: {
            ...DEFAULT_HEADERS,
            'Authorization': `Bearer ${accessToken}`,
        },
        tags: { name: 'update_schedule_status' },
        timeout: TIMEOUTS.default,
    };

    const response = http.patch(
        `${BASE_URL}/schedule/${scheduleId}/status`,
        payload,
        params
    );

    check(response, {
        'update_schedule_status: status is 204': (r) => r.status === 204,
    });

    return response;
}

/**
 * AI 스케줄 배치
 *
 * 왜 이 함수가 특별히 중요한가?
 * - 외부 AI 서비스 호출로 응답 시간이 가장 김
 * - 타임아웃 설정이 중요 (최대 30초)
 * - 서버 리소스 집약적 (AI 응답 파싱, DB 다중 쓰기)
 * - 동시 요청 시 AI 서비스 Rate Limiting 발생 가능
 *
 * @param {string} accessToken - JWT 액세스 토큰
 * @param {number} dayPlanId - DayPlan ID
 */
export function aiScheduleArrangement(accessToken, dayPlanId) {
    const params = {
        headers: {
            ...DEFAULT_HEADERS,
            'Authorization': `Bearer ${accessToken}`,
        },
        tags: { name: 'ai_arrangement' },
        timeout: TIMEOUTS.ai_related, // 30초 타임아웃
    };

    const response = http.post(
        `${BASE_URL}/day-plan/${dayPlanId}/schedules/ai-arrangement`,
        null,
        params
    );

    aiArrangementDuration.add(response.timings.duration);

    check(response, {
        'ai_arrangement: status is 200 or 201': (r) => r.status === 200 || r.status === 201,
        'ai_arrangement: response time < 5000ms': (r) => r.timings.duration < 5000,
    });

    return response;
}

// ============================================================================
// 알림 관련 함수
// ============================================================================

/**
 * 알림 목록 조회
 *
 * @param {string} accessToken - JWT 액세스 토큰
 * @param {number} page - 페이지 번호
 * @param {number} size - 페이지 크기
 */
export function getNotifications(accessToken, page = 1, size = 10) {
    const params = {
        headers: {
            ...DEFAULT_HEADERS,
            'Authorization': `Bearer ${accessToken}`,
        },
        tags: { name: 'get_notifications' },
        timeout: TIMEOUTS.default,
    };

    const response = http.get(
        `${BASE_URL}/notifications?page=${page}&size=${size}`,
        params
    );

    check(response, {
        'get_notifications: status is 200': (r) => r.status === 200,
    });

    return response;
}

/**
 * FCM 토큰 등록
 *
 * @param {string} accessToken - JWT 액세스 토큰
 * @param {string} fcmToken - FCM 토큰
 * @param {string} platform - 플랫폼 (IOS, ANDROID, WEB)
 */
export function registerFcmToken(accessToken, fcmToken, platform = 'WEB') {
    const payload = JSON.stringify({
        fcmToken: fcmToken,
        platform: platform,
    });

    const params = {
        headers: {
            ...DEFAULT_HEADERS,
            'Authorization': `Bearer ${accessToken}`,
        },
        tags: { name: 'register_fcm_token' },
        timeout: TIMEOUTS.default,
    };

    const response = http.post(`${BASE_URL}/fcm-tokens`, payload, params);

    check(response, {
        'register_fcm_token: status is 204': (r) => r.status === 204,
    });

    return response;
}

// ============================================================================
// 헬스체크 함수
// ============================================================================

/**
 * 서버 헬스체크
 *
 * 왜 이 함수가 필요한가?
 * - 테스트 시작 전 서버 가용성 확인
 * - 테스트 중간 서버 상태 모니터링
 * - 가장 가벼운 요청으로 네트워크 지연 기준선 측정
 */
export function healthCheck() {
    const response = http.get(`${BASE_URL}/`, {
        tags: { name: 'health_check' },
        timeout: TIMEOUTS.default,
    });

    const success = check(response, {
        'health_check: status is 200': (r) => r.status === 200,
        'health_check: response time < 100ms': (r) => r.timings.duration < 100,
    });

    return success;
}

// ============================================================================
// 유틸리티 함수
// ============================================================================

/**
 * 사용자 행동 시뮬레이션을 위한 랜덤 대기
 *
 * 왜 이 함수가 필요한가?
 * - 실제 사용자는 페이지 읽기, 입력 등으로 요청 사이 간격이 있음
 * - 일정한 간격의 요청은 비현실적이고 서버에 과도한 부하 발생
 * - Think Time을 추가하여 실제 트래픽 패턴 시뮬레이션
 *
 * @param {number} min - 최소 대기 시간 (초)
 * @param {number} max - 최대 대기 시간 (초)
 */
export function thinkTime(min = 1, max = 3) {
    const duration = min + Math.random() * (max - min);
    sleep(duration);
}

/**
 * 테스트 사용자 선택
 *
 * 각 VU가 서로 다른 사용자로 테스트하도록 함
 *
 * @param {array} users - 테스트 사용자 배열
 * @param {number} vuId - VU ID (__VU)
 * @returns {object} - 선택된 사용자 정보
 */
export function selectTestUser(users, vuId) {
    const index = (vuId - 1) % users.length;
    return users[index];
}
