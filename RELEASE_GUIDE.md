# 🚀 Release Repository Setup Guide

이 문서는 Social Archiver의 release 전용 public 레포지토리 설정 가이드입니다.

## 📁 Repository Structure

```
obsidian-social-archiver/          (Release Repo - Public)
├── .github/
│   └── workflows/
│       └── release.yml            # 자동 릴리즈 워크플로우
├── main.js                        # 빌드된 플러그인 (커밋 필요)
├── styles.css                     # 빌드된 스타일 (커밋 필요)
├── manifest.json                  # 플러그인 메타데이터
├── versions.json                  # 버전 호환성 정보
├── README.md                      # 사용자용 문서
├── LICENSE                        # MIT 라이선스
├── .gitignore                     # Git 무시 파일
└── RELEASE_GUIDE.md               # 이 파일
```

## 🔧 Initial Setup

### 1. GitHub에서 새 Public Repository 생성

```bash
# GitHub에서 "obsidian-social-archiver" 이름으로 public repo 생성
# README, .gitignore, License는 추가하지 않음 (이미 준비됨)
```

### 2. Release 레포지토리 초기화

```bash
# 준비된 파일들이 있는 디렉토리로 이동
cd /tmp/obsidian-social-archiver-release

# Git 초기화
git init
git add .
git commit -m "chore: initial release repository setup"

# GitHub 원격 레포지토리 연결
git remote add origin https://github.com/hyungyunlim/obsidian-social-archiver.git
git branch -M main
git push -u origin main
```

### 3. GitHub Actions 권한 설정

1. GitHub 레포지토리 → **Settings**
2. 왼쪽 메뉴에서 **Actions** → **General**
3. **Workflow permissions** 섹션에서:
   - ✅ **Read and write permissions** 선택
   - ✅ **Allow GitHub Actions to create and approve pull requests** 체크
4. **Save** 클릭

## 📦 Release Workflow

### Private 레포에서 Build → Public 레포로 Release

#### Step 1: Private 레포에서 빌드

```bash
# Private 개발 레포에서
cd /Users/hyungyunlim/obsidian-social-archiver

# Production 빌드
npm run build

# 빌드 결과 확인
ls -lh main.js manifest.json styles.css
```

#### Step 2: Release 레포로 빌드 파일 복사

```bash
# Release 레포 경로 설정 (예시)
RELEASE_REPO="/path/to/obsidian-social-archiver-release"

# 빌드 파일 복사
cp main.js "$RELEASE_REPO/"
cp styles.css "$RELEASE_REPO/"
cp manifest.json "$RELEASE_REPO/"

# versions.json 업데이트 (필요시)
cp versions.json "$RELEASE_REPO/"
```

**또는 스크립트 사용:**

```bash
# Private 레포에 deploy-to-release.sh 생성
cat > scripts/deploy-to-release.sh << 'EOF'
#!/bin/bash
set -e

RELEASE_REPO="${RELEASE_REPO:-$HOME/repos/obsidian-social-archiver-release}"

echo "🔨 Building plugin..."
npm run build

echo "📋 Copying files to release repo..."
cp main.js "$RELEASE_REPO/"
cp styles.css "$RELEASE_REPO/"
cp manifest.json "$RELEASE_REPO/"
cp versions.json "$RELEASE_REPO/"

echo "✅ Files copied to $RELEASE_REPO"
echo "Next steps:"
echo "  cd $RELEASE_REPO"
echo "  git add main.js styles.css manifest.json versions.json"
echo "  git commit -m 'build: update to version X.Y.Z'"
echo "  git push"
echo "  git tag X.Y.Z"
echo "  git push origin X.Y.Z"
EOF

chmod +x scripts/deploy-to-release.sh

# 사용
export RELEASE_REPO="/path/to/release/repo"
./scripts/deploy-to-release.sh
```

#### Step 3: Release 레포에서 커밋 & 태그

```bash
cd "$RELEASE_REPO"

# 빌드 파일 커밋
git add main.js styles.css manifest.json versions.json
git commit -m "build: update to version 1.0.3"
git push

# 태그 생성 (버전 번호만, 'v' 접두사 없음!)
git tag -a 1.0.3 -m "1.0.3"
git push origin 1.0.3
```

#### Step 4: GitHub Actions가 자동으로 Release 생성

1. GitHub → **Actions** 탭에서 워크플로우 실행 확인
2. 완료되면 **Releases** 탭에서 draft release 확인
3. Draft release 편집:
   - Release notes 작성
   - **Publish release** 클릭

## 📝 Version Bump Workflow

### 1.0.3 → 1.0.4 업데이트 예시

#### Private 레포에서:

```bash
# 1. manifest.json 버전 업데이트
# "version": "1.0.4"

# 2. package.json 버전 업데이트
# "version": "1.0.4"

# 3. versions.json에 새 버전 추가
# {
#   "1.0.4": "1.5.0",
#   "1.0.3": "1.5.0",
#   ...
# }

# 4. 빌드
npm run build

# 5. 커밋 (private 레포)
git add manifest.json package.json versions.json
git commit -m "chore: bump version to 1.0.4"
git push
```

#### Release 레포로 배포:

```bash
# 1. 빌드 파일 복사
./scripts/deploy-to-release.sh

# 2. Release 레포에서 커밋
cd "$RELEASE_REPO"
git add main.js styles.css manifest.json versions.json
git commit -m "build: update to version 1.0.4"
git push

# 3. 태그 생성 및 푸시
git tag -a 1.0.4 -m "1.0.4"
git push origin 1.0.4
```

## ⚠️ Important Notes

### Version Format (매우 중요!)

✅ **올바른 형식**: `1.0.3`
❌ **잘못된 형식**: `v1.0.3`, `version-1.0.3`

Obsidian은 버전 번호에 'v' 접두사나 다른 문자를 허용하지 않습니다.

### Build Artifacts 커밋

Release 레포에서는 **main.js와 styles.css를 반드시 커밋**해야 합니다:

- Private 레포: `.gitignore`에서 빌드 파일 제외
- Public 레포: 빌드 파일을 커밋 (사용자가 다운로드)

### versions.json 관리

```json
{
  "1.0.4": "1.5.0",  // 새 버전 추가
  "1.0.3": "1.5.0",
  "1.0.2": "1.5.0",
  "1.0.1": "1.5.0",
  "1.0.0": "1.5.0"
}
```

- Key: 플러그인 버전
- Value: 최소 요구 Obsidian 버전

## 📋 Release Checklist

릴리즈 전 체크리스트:

- [ ] manifest.json 버전 업데이트
- [ ] package.json 버전 업데이트
- [ ] versions.json에 새 버전 추가
- [ ] Private 레포에서 `npm run build` 실행
- [ ] 빌드 결과 확인 (main.js, styles.css 생성 확인)
- [ ] Release 레포로 파일 복사
- [ ] Release 레포에서 커밋 & 푸시
- [ ] 태그 생성 (버전 번호만, 'v' 없이!)
- [ ] 태그 푸시
- [ ] GitHub Actions 워크플로우 성공 확인
- [ ] Draft release에 release notes 작성
- [ ] Release 퍼블리시

## 🔄 Automation Ideas

### Option 1: GitHub Actions with Webhook

Private 레포에서 태그를 푸시하면 자동으로 빌드하고 Release 레포로 푸시:

```yaml
# Private 레포의 .github/workflows/build-and-release.yml
name: Build and Publish to Release Repo

on:
  push:
    tags:
      - "*"

jobs:
  build-and-release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20.x"

      - name: Install and Build
        run: |
          npm ci
          npm run build

      - name: Push to Release Repo
        env:
          RELEASE_REPO_TOKEN: ${{ secrets.RELEASE_REPO_TOKEN }}
        run: |
          git clone https://x-access-token:${RELEASE_REPO_TOKEN}@github.com/hyungyunlim/obsidian-social-archiver.git release-repo
          cd release-repo
          cp ../main.js ../styles.css ../manifest.json ../versions.json .
          git config user.name "GitHub Actions"
          git config user.email "actions@github.com"
          git add main.js styles.css manifest.json versions.json
          git commit -m "build: update to version ${GITHUB_REF#refs/tags/}"
          git push
          git tag ${GITHUB_REF#refs/tags/}
          git push origin ${GITHUB_REF#refs/tags/}
```

### Option 2: Manual Script (Recommended for now)

```bash
# scripts/release.sh
#!/bin/bash
set -e

VERSION=$1
if [ -z "$VERSION" ]; then
  echo "Usage: ./scripts/release.sh <version>"
  echo "Example: ./scripts/release.sh 1.0.4"
  exit 1
fi

echo "🚀 Releasing version $VERSION"

# 1. Update versions in private repo
echo "📝 Updating version files..."
sed -i '' "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" manifest.json
sed -i '' "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" package.json

# Add to versions.json (requires jq)
jq --arg ver "$VERSION" '. = {($ver): "1.5.0"} + .' versions.json > versions.json.tmp
mv versions.json.tmp versions.json

# 2. Build
echo "🔨 Building..."
npm run build

# 3. Commit in private repo
echo "💾 Committing in private repo..."
git add manifest.json package.json versions.json
git commit -m "chore: bump version to $VERSION"
git push

# 4. Copy to release repo
echo "📋 Copying to release repo..."
RELEASE_REPO="${RELEASE_REPO:-$HOME/repos/obsidian-social-archiver-release}"
cp main.js styles.css manifest.json versions.json "$RELEASE_REPO/"

# 5. Commit and tag in release repo
echo "🏷️  Creating release..."
cd "$RELEASE_REPO"
git add main.js styles.css manifest.json versions.json
git commit -m "build: update to version $VERSION"
git push
git tag -a "$VERSION" -m "$VERSION"
git push origin "$VERSION"

echo "✅ Release $VERSION completed!"
echo "Check GitHub Actions: https://github.com/hyungyunlim/obsidian-social-archiver/actions"
```

사용:
```bash
chmod +x scripts/release.sh
./scripts/release.sh 1.0.4
```

## 🎯 Community Plugin Submission

Release 레포가 준비되고 최소 1개의 릴리즈가 퍼블리시되면:

### 1. obsidian-releases 레포에 PR 제출

```bash
# 1. Fork https://github.com/obsidianmd/obsidian-releases

# 2. Clone your fork
git clone https://github.com/YOUR_USERNAME/obsidian-releases.git
cd obsidian-releases

# 3. Add your plugin to community-plugins.json
```

`community-plugins.json`에 추가:
```json
{
  "id": "social-archiver",
  "name": "Social Archiver",
  "author": "Hyungyun Lim",
  "description": "Archive social media posts from 8 platforms directly into your vault",
  "repo": "hyungyunlim/obsidian-social-archiver"
}
```

```bash
# 4. Commit and push
git add community-plugins.json
git commit -m "Add Social Archiver plugin"
git push

# 5. Create PR on GitHub
```

### 2. Review Process

- Obsidian 팀이 검토 (보통 1-2주 소요)
- 코드 품질, 보안, 정책 준수 확인
- 승인되면 Community Plugins에 자동 등록

### 3. 이후 업데이트

- Release 레포에서 새 태그 푸시만 하면 자동 업데이트
- Obsidian이 주기적으로 releases를 체크하여 사용자에게 알림

## 🔍 Troubleshooting

### Build 파일이 너무 큼

- `main.js`가 1MB 이상이면 최적화 검토
- Vite의 minify, terser 옵션 확인
- 불필요한 dependencies 제거

### GitHub Actions 실패

```bash
# 로컬에서 검증
cd release-repo

# 파일 존재 확인
ls -lh main.js manifest.json styles.css

# 버전 일치 확인
grep version manifest.json
git describe --tags --abbrev=0
```

### 태그 삭제 및 재생성

```bash
# 로컬 태그 삭제
git tag -d 1.0.3

# 원격 태그 삭제
git push origin :refs/tags/1.0.3

# 다시 생성
git tag -a 1.0.3 -m "1.0.3"
git push origin 1.0.3
```

## 📚 References

- [Obsidian Plugin Guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines)
- [Obsidian Release Docs](https://docs.obsidian.md/Plugins/Releasing/Release+your+plugin+with+GitHub+Actions)
- [Sample Plugin](https://github.com/obsidianmd/obsidian-sample-plugin)
- [Community Plugins Repo](https://github.com/obsidianmd/obsidian-releases)

---

**준비 완료!** 이제 첫 번째 릴리즈를 만들 준비가 되었습니다. 🚀
