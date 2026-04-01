# ☁️ 7팀 Cloud Infrastructure

클라우드 인프라 아키텍처 및 배포 기록 레포지토리

---

## Architecture Versions

| 버전 | 배포 방식 | 설명 |
|------|----------|------|
| **v1** | 빅뱅 배포 | 단일 환경 일괄 배포 |
| **v2** | 멀티클라우드 | 다중 클라우드 환경 구성 |
| **v3** | 쿠버네티스 | K8s 클러스터 기반 배포 |

---

## Repository Structure

```
.
├── v1-bigbang/          # v1 빅뱅 배포 관련
├── v2-multicloud/       # v2 멀티클라우드 구성
├── v3-kubernetes/       # v3 K8s 매니페스트, Helm Charts
├── iac/                 # Terraform 등 IaC 코드
├── load-test/           # 부하 테스트 스크립트
└── docs/                # 아키텍처 문서 및 다이어그램
```

---

## Tech Stack

Terraform · Docker · Kubernetes · Helm · GitHub Actions · ArgoCD · Prometheus · Grafana

---

## 📝 Note

KTB (Kakao Tech Bootcamp) 과정 프로젝트입니다.
