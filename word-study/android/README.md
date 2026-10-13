# 拾词 Android

适用于 Android 8.0 及以上的安卓手机和平板。使用系统 Android System WebView；建议保持 WebView 更新。APK 不适用于 iPad。

## 安装和使用

从仓库的 [`releases/Words-Learning-1.0.0.apk`](../../releases/Words-Learning-1.0.0.apk) 下载安装包，传到安卓设备后打开安装。首次安装时，按系统提示允许当前浏览器或文件管理器安装此来源的应用。

- 七本词书内置，无需连接电脑或网络，也无需 Python。
- 每轮 1–100 词；核对本轮全部中文后修正勾选，再保存到生词本。
- 每本词书独立保存当前轮、勾选和学习进度，横竖屏切换时继续学习。
- 学习页、词书浏览页都有「重置本书进度」。只重置该书已刷词、轮数、当前轮；保留其他书、生词本及累计统计。生词本上的重置只重置复习进度。
- 浏览页面可以按英文或中文搜索。
- 导出 PDF 使用安卓文件选择器指定保存位置。英文在左、中文在右，自动分页，内嵌字体。
- 「学习设置 → 下载备份 / 导入备份」支持电脑端和安卓端的 schemaVersion 1 JSON 文件。导入先验证并预览生词数量及累计刷词数，确认后替换当前记录。

电脑进度迁移：在电脑网站下载备份，把 JSON 文件传到手机，在安卓应用中导入。设备之间不会自动同步。卸载应用或清除应用数据会删除记录，请先导出备份。以后使用同签名的新版 APK 覆盖安装可以保留记录。

## 数据和结构

`MainActivity` 只加载 APK 内的 HTTPS 虚拟来源 `https://appassets.androidplatform.net/`，不申请网络、联系人或共享存储权限。外部来源链接交给系统浏览器。导入、导出通过 Storage Access Framework 访问用户选择的单个文件。

`StudyStorage` 把 JSON 写入应用私有目录，以 `AtomicFile` 原子替换；普通保存保留上一份副本，导入前保留 `state.before-import.json`。前端只在写入成功后更新权威状态。

`public/mobile-engine.mjs` 实现离线学习规则；`public/platform.js` 连接原生文件存储及导出。电脑版继续使用 `server.py`。打包任务只复制 `public/`、`data/books/` 和 ECDICT 许可，**不会包含电脑上的个人学习记录**。

## 构建

需要 JDK 17、Android SDK Platform 35、Build Tools 35.0.0；Gradle Wrapper 固定为 8.11.1，Android Gradle Plugin 固定为 8.9.2。

1. 设置 `JAVA_HOME` 为 JDK 17 路径。
2. 设置 `ANDROID_HOME`，或在本目录 `local.properties` 中写 `sdk.dir=你的SDK路径`（建议正斜杠）。
3. 在本目录运行 `./gradlew assembleDebug`（Windows 为 `./gradlew.bat assembleDebug`）。

调试包输出为 `app/build/outputs/apk/debug/app-debug.apk`。

正式包使用自己的长期签名。复制 `signing.example.properties` 为 `signing.properties`，填入本地密钥库和密码，运行 `./gradlew.bat assembleRelease lintRelease`。输出为 `app/build/outputs/apk/release/app-release.apk`。每次发布时递增 `versionCode`，并保留相同 applicationId 和签名。

本机此次发布使用的密钥库在 `keystore/words-learning.jks`，密码配置在 `signing.properties`；均已排除 Git。请一起妥善备份，以便后续覆盖升级。仓库不包含私钥。

## 验证

```powershell
node ../tools/verify-mobile.mjs
./gradlew.bat assembleDebug assembleDebugAndroidTest lintRelease
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
# 下两行只能对一次性测试模拟器执行，会清空该模拟器中的拾词数据。
adb -s emulator-5554 shell pm clear com.jisongmuli.wordslearning
adb -s emulator-5554 shell am instrument -w com.jisongmuli.wordslearning.test/com.jisongmuli.wordslearning.SmokeTest
```

自动检查覆盖离线状态持久化、修正勾选、随机未学词、生词去重、单书重置隔离、错误备份拒绝、写入失败回滚、真实 WebView 学习流程和 Android 原生 PDF。PDF 测试文件生成在模拟器的应用外部文件目录。2026-10-13 在 Android 15 模拟器验证了手机、平板布局、系统文件选择器导出和导入；六级整本 PDF 共 380 页，检查了首、中、末页。尚未在实体手机上测试。

实现参考：[Android 本地 WebView 内容](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content)、[Storage Access Framework](https://developer.android.com/training/data-storage/shared/documents-files)。
