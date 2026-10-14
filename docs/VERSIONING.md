# GitHub 版本维护

项目仓库：https://github.com/write-against-wind/miyu

源码、测试、说明文档和依赖清单进入 Git。开发依赖、缓存、测试截图、密码库及备份文件不提交。Windows `.exe` 和 SHA-256 校验文件由发布流程上传到 GitHub Releases。

## 日常修改

第一次从仓库取得源码，或本机清理过依赖时，先安装 Node.js 22.12 或以上版本并执行 `npm ci`。

```powershell
git pull --ff-only
git switch -c feat/功能名称
npm ci
npm start
# 修改源码后：
npm test
npm run test:e2e
git add src tests scripts README.md CHANGELOG.md
git commit -m "feat: 描述本次功能改动"
git push -u origin HEAD
```

在 GitHub 上发起 Pull Request 合并到 `main`。每条提交保存一次修改，可在仓库的 Commits 页面查看和比较；推送到 `main` 或创建 Pull Request 会自动执行 Windows 测试。提交消息可使用 `feat:`（功能）、`fix:`（修复）、`docs:`（文档）、`chore:`（维护）。

## 发布新版本

版本号建议：修复用 `1.0.2`，新增兼容功能用 `1.1.0`，不兼容变更用 `2.0.0`。

以发布 `1.0.2` 为例，在需要发布的代码已合并到 `main` 后执行：

```powershell
git switch main
git pull --ff-only
npm version patch --no-git-tag-version --ignore-scripts
# 编辑 CHANGELOG.md，新增 ## [1.0.2] 并写明该版本改动。
npm run check:version
git add package.json package-lock.json CHANGELOG.md
git commit -m "chore: release v1.0.2"
git tag -a v1.0.2 -m "密屿 v1.0.2"
git push origin main
git push origin v1.0.2
```

推送版本标签会启动 `Windows release` 工作流：

1. 校验标签、`package.json`、`package-lock.json` 和更新日志的版本一致。
2. 执行核心测试和桌面测试，构建 Windows x64 便携版。
3. 检查打包程序可以启动，生成 SHA-256 校验文件。
4. 自动创建对应 GitHub Release，附上该版本说明、`.exe` 和校验文件。

在仓库 **Actions** 页面查看进度，在 **Releases** 页面下载各版本。自动发布使用仓库自带的 `GITHUB_TOKEN`，不需要把个人访问令牌写入文件。工作流需要仓库允许 GitHub Actions 运行；发布任务仅为创建 Release 请求 `contents: write` 权限。

标签只为正式发布创建；日常提交不要创建标签。已发布版本不要通过强制推送改写，修复后发布新版本。发布流程失败时，在修复对应原因后使用 Actions 的 Re-run jobs；如果代码需要变更，应提交新版本并推送新标签。

## 查看或恢复旧版本

```powershell
git log --oneline --decorate
git diff v1.0.1..v1.0.2
git switch -c inspect/v1.0.1 v1.0.1
```

上面最后一条命令从旧标签创建独立分支，不覆盖主分支。如果只是想使用旧版程序，直接从 Releases 下载对应 `.exe`。升级或回退前建议导出加密备份；Git 不保存实际账号数据。

## 本地存储空间

依赖可随时通过 `npm ci` 恢复。下载和构建会临时增加本机磁盘占用；完成后可以清理 `node_modules/`、`.npm-cache/`、`.tools/`、`dist/win-unpacked/`，保留当前 `.exe` 和源代码。GitHub Actions 在云端构建，不要求本机长期保留这些文件。

参考：[GitHub Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)、[GitHub Actions 工作流触发](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)。
