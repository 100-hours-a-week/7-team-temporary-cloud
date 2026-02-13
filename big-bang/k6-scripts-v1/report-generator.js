/**
 * K6 보고서 자동 생성 모듈
 *
 * 각 테스트 파일에서 import하여 사용
 * HTML + JSON 보고서 자동 생성
 */

/**
 * HTML 보고서 생성
 */
export function generateHtmlReport(data, testName) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const metrics = data.metrics;

    // 주요 메트릭 추출
    const httpReqDuration = metrics.http_req_duration || {};
    const httpReqFailed = metrics.http_req_failed || {};
    const httpReqs = metrics.http_reqs || {};
    const iterations = metrics.iterations || {};
    const vus = metrics.vus || {};

    // HTTP 상세 메트릭
    const httpReqBlocked = metrics.http_req_blocked || {};
    const httpReqConnecting = metrics.http_req_connecting || {};
    const httpReqTlsHandshaking = metrics.http_req_tls_handshaking || {};
    const httpReqSending = metrics.http_req_sending || {};
    const httpReqWaiting = metrics.http_req_waiting || {};
    const httpReqReceiving = metrics.http_req_receiving || {};

    // 커스텀 Duration 메트릭 추출
    const customDurationMetrics = {};
    const durationMetricNames = [
        'signup_duration',
        'login_duration',
        'create_schedule_duration',
        'get_schedules_duration',
        'get_profile_duration',
        'search_users_duration',
        'delete_schedule_duration',
        'full_scenario_duration',
        'group_duration',
        'iteration_duration'
    ];

    durationMetricNames.forEach(name => {
        if (metrics[name]) {
            customDurationMetrics[name] = metrics[name];
        }
    });

    // 임계값 결과
    const thresholds = data.thresholds || {};
    const thresholdResults = Object.entries(thresholds).map(([name, result]) => ({
        name,
        passed: result.ok,
    }));

    const passedThresholds = thresholdResults.filter(t => t.passed).length;
    const failedThresholds = thresholdResults.filter(t => !t.passed).length;

    // 체크 결과 - 모든 그룹에서 수집
    const allChecks = collectAllChecks(data.root_group);

    // 시나리오 실패율
    const scenarioFailures = metrics.scenario_failures || {};

    const html = `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>K6 부하테스트 보고서 - ${testName}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            background: #f5f5f5;
            color: #333;
            line-height: 1.6;
        }
        .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
        header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 40px 20px;
            text-align: center;
            margin-bottom: 30px;
            border-radius: 10px;
        }
        header h1 { font-size: 2.5em; margin-bottom: 10px; }
        header .timestamp { opacity: 0.9; font-size: 1.1em; }

        .summary-cards {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .card {
            background: white;
            border-radius: 10px;
            padding: 25px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .card h3 { color: #666; font-size: 0.9em; text-transform: uppercase; margin-bottom: 10px; }
        .card .value { font-size: 2.2em; font-weight: bold; color: #333; }
        .card .unit { font-size: 0.9em; color: #888; }
        .card.success .value { color: #10b981; }
        .card.warning .value { color: #f59e0b; }
        .card.danger .value { color: #ef4444; }

        .section {
            background: white;
            border-radius: 10px;
            padding: 30px;
            margin-bottom: 20px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .section h2 {
            font-size: 1.5em;
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 2px solid #eee;
        }

        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 12px 15px; text-align: left; border-bottom: 1px solid #eee; }
        th { background: #f8f9fa; font-weight: 600; color: #555; }
        tr:hover { background: #f8f9fa; }

        .status-badge {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.85em;
            font-weight: 500;
        }
        .status-pass { background: #d1fae5; color: #065f46; }
        .status-fail { background: #fee2e2; color: #991b1b; }

        .metric-bar {
            height: 8px;
            background: #e5e7eb;
            border-radius: 4px;
            overflow: hidden;
            margin-top: 5px;
        }
        .metric-bar-fill {
            height: 100%;
            background: linear-gradient(90deg, #10b981, #34d399);
            border-radius: 4px;
        }
        .metric-bar-fill.warning { background: linear-gradient(90deg, #f59e0b, #fbbf24); }
        .metric-bar-fill.danger { background: linear-gradient(90deg, #ef4444, #f87171); }

        .warning-text { color: #f59e0b; font-weight: bold; }
        .danger-text { color: #ef4444; font-weight: bold; }

        details summary:hover { background: #e9ecef; }
        pre { white-space: pre-wrap; word-wrap: break-word; }

        .footer {
            text-align: center;
            padding: 20px;
            color: #888;
            font-size: 0.9em;
        }

        @media (max-width: 768px) {
            header h1 { font-size: 1.8em; }
            .card .value { font-size: 1.8em; }
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>🚀 ${testName} 보고서</h1>
            <div class="timestamp">생성일시: ${new Date().toLocaleString('ko-KR')}</div>
        </header>

        <div class="summary-cards">
            <div class="card ${getStatusClass(httpReqFailed.values?.rate, 0.01, 0.05)}">
                <h3>요청 성공률</h3>
                <div class="value">${((1 - (httpReqFailed.values?.rate || 0)) * 100).toFixed(2)}<span class="unit">%</span></div>
            </div>
            <div class="card">
                <h3>총 요청 수</h3>
                <div class="value">${formatNumber(httpReqs.values?.count || 0)}</div>
            </div>
            <div class="card">
                <h3>평균 응답시간</h3>
                <div class="value">${(httpReqDuration.values?.avg || 0).toFixed(0)}<span class="unit">ms</span></div>
            </div>
            <div class="card ${getStatusClass(httpReqDuration.values?.['p(95)'], 2000, 5000)}">
                <h3>P95 응답시간</h3>
                <div class="value">${(httpReqDuration.values?.['p(95)'] || 0).toFixed(0)}<span class="unit">ms</span></div>
            </div>
            <div class="card">
                <h3>처리량 (RPS)</h3>
                <div class="value">${(httpReqs.values?.rate || 0).toFixed(1)}<span class="unit">/s</span></div>
            </div>
            <div class="card">
                <h3>최대 VUs</h3>
                <div class="value">${vus.values?.max || 0}</div>
            </div>
        </div>

        <div class="section">
            <h2>📊 응답 시간 상세</h2>
            <table>
                <thead>
                    <tr>
                        <th>메트릭</th>
                        <th>값</th>
                        <th>분포</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>최소 (Min)</td>
                        <td>${(httpReqDuration.values?.min || 0).toFixed(2)} ms</td>
                        <td><div class="metric-bar"><div class="metric-bar-fill" style="width: ${getPercentage(httpReqDuration.values?.min, httpReqDuration.values?.max)}%"></div></div></td>
                    </tr>
                    <tr>
                        <td>평균 (Avg)</td>
                        <td>${(httpReqDuration.values?.avg || 0).toFixed(2)} ms</td>
                        <td><div class="metric-bar"><div class="metric-bar-fill" style="width: ${getPercentage(httpReqDuration.values?.avg, httpReqDuration.values?.max)}%"></div></div></td>
                    </tr>
                    <tr>
                        <td>중앙값 (Med)</td>
                        <td>${(httpReqDuration.values?.med || 0).toFixed(2)} ms</td>
                        <td><div class="metric-bar"><div class="metric-bar-fill" style="width: ${getPercentage(httpReqDuration.values?.med, httpReqDuration.values?.max)}%"></div></div></td>
                    </tr>
                    <tr>
                        <td>P90</td>
                        <td>${(httpReqDuration.values?.['p(90)'] || 0).toFixed(2)} ms</td>
                        <td><div class="metric-bar"><div class="metric-bar-fill" style="width: ${getPercentage(httpReqDuration.values?.['p(90)'], httpReqDuration.values?.max)}%"></div></div></td>
                    </tr>
                    <tr>
                        <td>P95</td>
                        <td>${(httpReqDuration.values?.['p(95)'] || 0).toFixed(2)} ms</td>
                        <td><div class="metric-bar"><div class="metric-bar-fill ${httpReqDuration.values?.['p(95)'] > 2000 ? 'warning' : ''}" style="width: ${getPercentage(httpReqDuration.values?.['p(95)'], httpReqDuration.values?.max)}%"></div></div></td>
                    </tr>
                    <tr>
                        <td>P99</td>
                        <td>${(httpReqDuration.values?.['p(99)'] || 0).toFixed(2)} ms</td>
                        <td><div class="metric-bar"><div class="metric-bar-fill ${httpReqDuration.values?.['p(99)'] > 5000 ? 'danger' : ''}" style="width: ${getPercentage(httpReqDuration.values?.['p(99)'], httpReqDuration.values?.max)}%"></div></div></td>
                    </tr>
                    <tr>
                        <td>최대 (Max)</td>
                        <td>${(httpReqDuration.values?.max || 0).toFixed(2)} ms</td>
                        <td><div class="metric-bar"><div class="metric-bar-fill danger" style="width: 100%"></div></div></td>
                    </tr>
                </tbody>
            </table>
        </div>

        <div class="section">
            <h2>✅ 임계값 (Thresholds) 결과</h2>
            <div style="margin-bottom: 15px;">
                <span class="status-badge status-pass">통과: ${passedThresholds}</span>
                <span class="status-badge status-fail" style="margin-left: 10px;">실패: ${failedThresholds}</span>
            </div>
            <table>
                <thead>
                    <tr>
                        <th>임계값</th>
                        <th>결과</th>
                    </tr>
                </thead>
                <tbody>
                    ${thresholdResults.map(t => `
                    <tr>
                        <td>${t.name}</td>
                        <td><span class="status-badge ${t.passed ? 'status-pass' : 'status-fail'}">${t.passed ? 'PASS' : 'FAIL'}</span></td>
                    </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>

        <div class="section">
            <h2>📈 실행 정보</h2>
            <table>
                <tbody>
                    <tr><td><strong>테스트 이름</strong></td><td>${testName}</td></tr>
                    <tr><td><strong>총 반복 횟수</strong></td><td>${formatNumber(iterations.values?.count || 0)}</td></tr>
                    <tr><td><strong>반복 속도</strong></td><td>${(iterations.values?.rate || 0).toFixed(2)} /s</td></tr>
                    <tr><td><strong>총 요청 수</strong></td><td>${formatNumber(httpReqs.values?.count || 0)}</td></tr>
                    <tr><td><strong>처리량 (RPS)</strong></td><td>${(httpReqs.values?.rate || 0).toFixed(2)} /s</td></tr>
                    <tr><td><strong>최대 VUs</strong></td><td>${vus.values?.max || 0}</td></tr>
                    <tr><td><strong>시나리오 실패율</strong></td><td>${((scenarioFailures.values?.rate || 0) * 100).toFixed(2)}%</td></tr>
                </tbody>
            </table>
        </div>

        <div class="section">
            <h2>🔍 API별 응답시간 상세</h2>
            <table>
                <thead>
                    <tr>
                        <th>API</th>
                        <th>Avg</th>
                        <th>Med</th>
                        <th>Min</th>
                        <th>Max</th>
                        <th>P90</th>
                        <th>P95</th>
                    </tr>
                </thead>
                <tbody>
                    ${Object.entries(customDurationMetrics).map(([name, metric]) => `
                    <tr>
                        <td><strong>${formatMetricName(name)}</strong></td>
                        <td>${formatMs(metric.values?.avg)}</td>
                        <td>${formatMs(metric.values?.med)}</td>
                        <td>${formatMs(metric.values?.min)}</td>
                        <td class="${metric.values?.max > 1000 ? 'warning-text' : ''}">${formatMs(metric.values?.max)}</td>
                        <td>${formatMs(metric.values?.['p(90)'])}</td>
                        <td class="${metric.values?.['p(95)'] > 500 ? 'warning-text' : ''}">${formatMs(metric.values?.['p(95)'])}</td>
                    </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>

        <div class="section">
            <h2>🌐 HTTP 요청 상세 분석</h2>
            <p style="color: #666; margin-bottom: 15px;">요청이 처리되는 각 단계별 소요 시간</p>
            <table>
                <thead>
                    <tr>
                        <th>단계</th>
                        <th>설명</th>
                        <th>Avg</th>
                        <th>Med</th>
                        <th>P95</th>
                        <th>Max</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><strong>Blocked</strong></td>
                        <td>연결 대기 (커넥션 풀)</td>
                        <td>${formatMs(httpReqBlocked.values?.avg)}</td>
                        <td>${formatMs(httpReqBlocked.values?.med)}</td>
                        <td>${formatMs(httpReqBlocked.values?.['p(95)'])}</td>
                        <td>${formatMs(httpReqBlocked.values?.max)}</td>
                    </tr>
                    <tr>
                        <td><strong>Connecting</strong></td>
                        <td>TCP 연결 수립</td>
                        <td>${formatMs(httpReqConnecting.values?.avg)}</td>
                        <td>${formatMs(httpReqConnecting.values?.med)}</td>
                        <td>${formatMs(httpReqConnecting.values?.['p(95)'])}</td>
                        <td>${formatMs(httpReqConnecting.values?.max)}</td>
                    </tr>
                    <tr>
                        <td><strong>TLS Handshaking</strong></td>
                        <td>TLS/SSL 핸드셰이크</td>
                        <td>${formatMs(httpReqTlsHandshaking.values?.avg)}</td>
                        <td>${formatMs(httpReqTlsHandshaking.values?.med)}</td>
                        <td>${formatMs(httpReqTlsHandshaking.values?.['p(95)'])}</td>
                        <td>${formatMs(httpReqTlsHandshaking.values?.max)}</td>
                    </tr>
                    <tr>
                        <td><strong>Sending</strong></td>
                        <td>요청 전송</td>
                        <td>${formatMs(httpReqSending.values?.avg)}</td>
                        <td>${formatMs(httpReqSending.values?.med)}</td>
                        <td>${formatMs(httpReqSending.values?.['p(95)'])}</td>
                        <td>${formatMs(httpReqSending.values?.max)}</td>
                    </tr>
                    <tr>
                        <td><strong>Waiting (TTFB)</strong></td>
                        <td>서버 처리 시간</td>
                        <td>${formatMs(httpReqWaiting.values?.avg)}</td>
                        <td>${formatMs(httpReqWaiting.values?.med)}</td>
                        <td>${formatMs(httpReqWaiting.values?.['p(95)'])}</td>
                        <td>${formatMs(httpReqWaiting.values?.max)}</td>
                    </tr>
                    <tr>
                        <td><strong>Receiving</strong></td>
                        <td>응답 수신</td>
                        <td>${formatMs(httpReqReceiving.values?.avg)}</td>
                        <td>${formatMs(httpReqReceiving.values?.med)}</td>
                        <td>${formatMs(httpReqReceiving.values?.['p(95)'])}</td>
                        <td>${formatMs(httpReqReceiving.values?.max)}</td>
                    </tr>
                    <tr style="background: #f0f9ff; font-weight: bold;">
                        <td><strong>Total Duration</strong></td>
                        <td>전체 요청 시간</td>
                        <td>${formatMs(httpReqDuration.values?.avg)}</td>
                        <td>${formatMs(httpReqDuration.values?.med)}</td>
                        <td>${formatMs(httpReqDuration.values?.['p(95)'])}</td>
                        <td>${formatMs(httpReqDuration.values?.max)}</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <div class="section">
            <h2>✔️ 체크 결과 상세</h2>
            <table>
                <thead>
                    <tr>
                        <th>체크 항목</th>
                        <th>통과</th>
                        <th>실패</th>
                        <th>성공률</th>
                        <th>상태</th>
                    </tr>
                </thead>
                <tbody>
                    ${allChecks.map(check => {
                        const total = check.passes + check.fails;
                        const rate = total > 0 ? (check.passes / total * 100) : 0;
                        return `
                    <tr>
                        <td>${check.name}</td>
                        <td style="color: #10b981;">${check.passes}</td>
                        <td style="color: ${check.fails > 0 ? '#ef4444' : '#888'};">${check.fails}</td>
                        <td>${rate.toFixed(2)}%</td>
                        <td><span class="status-badge ${check.fails === 0 ? 'status-pass' : 'status-fail'}">${check.fails === 0 ? 'PASS' : 'FAIL'}</span></td>
                    </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>

        <div class="section">
            <h2>📋 전체 메트릭 (Raw Data)</h2>
            <details>
                <summary style="cursor: pointer; padding: 10px; background: #f8f9fa; border-radius: 5px;">클릭하여 펼치기</summary>
                <pre style="background: #1e1e1e; color: #d4d4d4; padding: 20px; border-radius: 5px; overflow-x: auto; margin-top: 10px; font-size: 12px;">${JSON.stringify(metrics, null, 2)}</pre>
            </details>
        </div>

        <footer>
            <p>Generated by K6 Load Test Suite | molip Backend</p>
        </footer>
    </div>
</body>
</html>`;

    return html;
}

function getStatusClass(value, warningThreshold, dangerThreshold) {
    if (value === undefined || value === null) return '';
    if (value > dangerThreshold) return 'danger';
    if (value > warningThreshold) return 'warning';
    return 'success';
}

function formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function getPercentage(value, max) {
    if (!value || !max) return 0;
    return Math.min((value / max) * 100, 100);
}

function formatMs(value) {
    if (value === undefined || value === null) return 'N/A';
    if (value < 1) return `${(value * 1000).toFixed(2)}µs`;
    if (value < 1000) return `${value.toFixed(2)}ms`;
    return `${(value / 1000).toFixed(2)}s`;
}

function formatMetricName(name) {
    const nameMap = {
        'signup_duration': '회원가입',
        'login_duration': '로그인',
        'create_schedule_duration': '스케줄 생성',
        'get_schedules_duration': '스케줄 조회',
        'get_profile_duration': '프로필 조회',
        'search_users_duration': '사용자 검색',
        'delete_schedule_duration': '스케줄 삭제',
        'full_scenario_duration': '전체 시나리오',
        'group_duration': '그룹',
        'iteration_duration': '반복'
    };
    return nameMap[name] || name;
}

function collectAllChecks(group, checks = []) {
    if (!group) return checks;

    // 현재 그룹의 체크 수집
    if (group.checks) {
        group.checks.forEach(check => {
            checks.push({
                name: check.name,
                passes: check.passes || 0,
                fails: check.fails || 0
            });
        });
    }

    // 하위 그룹 순회
    if (group.groups) {
        group.groups.forEach(subGroup => {
            collectAllChecks(subGroup, checks);
        });
    }

    return checks;
}

/**
 * handleSummary에서 사용할 보고서 생성 함수
 */
export function createReportOutput(data, testName) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const reportDir = 'k6-tests/reports';

    return {
        [`${reportDir}/${testName}-${timestamp}.html`]: generateHtmlReport(data, testName),
        [`${reportDir}/${testName}-${timestamp}.json`]: JSON.stringify(data, null, 2),
        'stdout': textSummary(data, { indent: '  ', enableColors: true }),
    };
}

// k6 내장 텍스트 요약
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';
