# 红米 AC2100 私人 OpenWrt 固件

一套"一键云编译"方案：把本仓库推到 GitHub，GitHub 的服务器会自动帮你编译出**带科学上网、广告过滤、多拨等插件的私人固件**，然后你下载 `.bin` 刷进路由器即可。**自己电脑什么都不用装、不用编译。**

---

## 两个版本（点 Run workflow 时选）

| 版本 | `profile` 填 | 里面有什么 | 适合 |
| --- | --- | --- | --- |
| **校园网防检测版**（默认） | `campus` | 内置 **UA2F 4.10.2**（主引擎，NFQUEUE，默认开）+ UA3F 3.7.0（备用，TPROXY，默认关）+「顺枫公寓自动登录」+ 认证门户探测 + 中文界面 + 排错工具 | 就是要解决校园网共享检测、老掉线 |
| 全能版 | `full` | 在校园网版基础上，再加 OpenClash / PassWall / SSR-Plus / AdGuard Home / 多拨 / 限速等 | 家里自用，还要科学上网和去广告 |

校园网那一套的完整用法（人格选择、验证、排错、回滚）见 👉 [docs/校园网防检测.md](docs/校园网防检测.md)

---

## 一、这台设备的底细（已核实）

| 项目 | 参数 |
| --- | --- |
| 设备 | Xiaomi Redmi Router AC2100 |
| OpenWrt 型号代号 | `xiaomi_redmi-router-ac2100` |
| 平台 / 子平台 | `ramips` / `mt7621` |
| CPU | MediaTek MT7621（双核 880MHz） |
| 2.4G 无线 | MT7603（驱动 `kmod-mt7603`） |
| 5G 无线 | MT7615（驱动 `kmod-mt7615-firmware`） |
| 内存 | 128MB |
| 闪存 | 128MB NAND，可用于系统的空间约 **117MB**（很够用） |
| 网口 | 1 WAN + 3 LAN（千兆），**没有 USB 口** |
| 后台地址 | `192.168.1.1`（本固件默认，可改） |

---

## 二、怎么用（只需要 3 步）

1. **注册 GitHub 账号**（免费）：<https://github.com/signup>
2. **新建一个仓库**（Repository），比如叫 `ac2100-firmware`，类型选 **Public**（公开仓库编译不消耗额度）或 Private 都行。
3. 点仓库页面的 **Add file → Upload files**，把下面这些**拖进去**（整个文件夹拖拽最省事）：
   - `.github/`
   - `configs/`
   - `device-files/`
   - `README.md`
   - `docs/`

   > 注意：`firmware/` 目录里是我帮你下载好的官方原版底包，**不用上传**，那是刷机时用的。
   > `vendor/` 目录里是 UA3F/UA2F 的官方安装包（留个底，方便你以后手动装），也不用上传。
   > 拖的时候如果看不到 `.github` 文件夹，在文件资源管理器里打开"显示隐藏项目"即可（它不是隐藏文件，正常情况下能直接看到）。
   > ⚠️ `device-files/` 现在有 **129 个文件 / 19MB**（含 16.8MB 的 UA3F 二进制）。GitHub 网页一次最多传 100 个文件，
   > 最稳的传法是**分两批**：第一批传 `device-files` 里除 `usr/bin/ua3f` 的部分，第二批单独传 `usr/bin/ua3f`（单文件 25MB 以内，能传）。
   > 或者干脆用 GitHub Desktop / `git push`，一次推完。

4. 传完后进 **Actions** 页面 → 左侧点「编译红米AC2100固件」→ 右边 **Run workflow**，两个参数：

   | 参数 | 填什么 |
   | --- | --- |
   | `profile` | `campus` ＝ 校园网防检测版（推荐）／`full` ＝ 全能版 |
   | `device` | 机型代号，默认 `xiaomi_redmi-router-ac2100`；换别的机器看 [configs/devices.list](configs/devices.list) 第一列（每行的最后一列写了该机型的最大固件体积，一眼看出装不装得下 UA3F） |

   填完点绿色按钮。
5. 等 **约 60~120 分钟**。构建成功后点进这次运行记录，页面底部 **Artifacts** 里下载 `firmware-*`，解压后就是你的私人固件：
   - `...-squashfs-sysupgrade.bin` ← **平时升级/刷入用这个**
   - `...-squashfs-kernel1.bin`、`...-squashfs-rootfs0.bin` ← 第一次从原厂系统刷入时配合使用

---

## 三、固件里装了什么

**校园网防检测**：**UA2F 4.10.2**（主引擎，NFQUEUE :10010，改 UA，TTL 由 ua2f-ttl 用 nft 固定）；**UA3F 3.7.0**（备引擎，TPROXY :1080，改 UA + 固定 TTL + 清 TCP 时间戳 + IPID 归零，页面在「服务 → UA3F」）；UA2F 4.10.2（备引擎，默认关闭，`ua-engine ua2f` 可切换，两者互斥）
**自己写的四个页面**（都在「服务」菜单）：**防检测引擎**（排第一，UA3F/UA2F 启停与档位控制台）、UA3F 防检测（详细设置）、连接设备、WAN MAC 工具
**自动登录 / 探测**：顺枫公寓自动登录（netcheck）、认证门户探测（portal-probe）
**科学上网（三种任选，默认都不自动启动）**：OpenClash、PassWall、SSR-Plus
**DNS / 去广告**：AdGuard Home
**网络增强**：mwan3 多拨、SQM 限速、UPnP、DDNS、流量统计（nlbwmon）、网络唤醒、定时重启
**系统工具**：网页终端 ttyd、自定义命令、SFTP（可用 WinSCP）、curl、htop、nano、iperf3
**界面**：Argon 主题 + 全中文
**默认设置**：固件名（LuCI 状态页「固件版本」）`by au VX：aauuo0 倒卖司马`、主机名（LuCI 左上角）`aauuo0`、后台 `192.168.1.1`、后台密码 `root`、2.4G WiFi `破解校园网V：aauuo0`、5G WiFi `破解校园网联系v：aauuo0`、WiFi 密码 `aaaauuuu`、无线开机自动启动

> 内存只有 128MB，OpenClash 和 AdGuard Home 同时开着会比较吃紧，建议按需只开一个。
> OpenClash 的内核（Mihomo）比较大，装好后第一次要在它的界面里点一次「更新内核」下载。

---

## 四、想改点东西

| 想改什么 | 改哪个文件 | 改哪一行 |
| --- | --- | --- |
| 后台地址 / 路由器名字 / 登录密码 | `device-files/etc/uci-defaults/99-personal` | 文件开头的 4 个变量 |
| WiFi 名字 / WiFi 密码 | `device-files/etc/init.d/personal-wifi` | 文件开头的 4 个变量 |
| 加/删插件 | `configs/ac2100.seed` | 注释掉某行 = 删掉该插件；去掉 `#` = 加上 |
| OpenWrt 版本 | `.github/workflows/build.yml` | `default: "v24.10.8"` |
| **UA3F 人格 UA / TTL** | `device-files/etc/config/ua3f` | `option ua`（换 UA）、`option l3_rewrite_ttl_value`（**默认 128＝电脑**；64＝手机） |
| **换 UA3F 的规则 / 模式** | 路由器上「服务 → UA3F」 | 改完点「保存并应用」，命令行等价 `uci commit ua3f && /etc/init.d/ua3f restart` |
| **切 UA3F ↔ UA2F ↔ 全关** | 路由器上执行 | `ua-engine ua3f` / `ua-engine ua2f` / `ua-engine off`（`ua-engine` 只看状态） |
| **网速慢（UA3F 老毛病）** | 路由器上执行 | 档位只剩「速度档」（只固定 TTL）；如果 `ua-engine status` 里看到 `TCPts=1` 或 `IPID=1`，执行 `ua-engine fast` 复位 |

改完在 GitHub 网页上重新上传该文件（或 `git push`），Actions 会自动重新编译。

---

## 五、刷机

红米 AC2100 是 NAND 双系统机型，**不能**用原厂网页后台直接刷。详细步骤（含救砖）见：

👉 [docs/flashing.md](docs/flashing.md)

一句话流程：原厂系统开 SSH → `mtd` 写入官方 `kernel1` + `rootfs0`（或用 `initramfs` 引导）→ 进入 OpenWrt → `sysupgrade` 刷入你自己的私人固件。

我放在 `firmware/openwrt-24.10.8/` 的官方底包已经过 SHA256 校验，可直接用于第一步。

---

## 六、常见问题

**Q：编译失败了怎么办？**
先点开失败的那一步看日志。多数情况是第三方插件源某个包当天坏了，重跑一次（Re-run failed jobs）往往就好了；如果一直失败，就在 `configs/ac2100.seed` 里把那个插件注释掉。

**Q：能直接刷官方 OpenWrt 吗？**
能。`firmware/openwrt-24.10.8/` 里就是官方原版，刷法和本固件完全一样，可以用来做对照测试。

**Q：为什么用 24.10 而不是最新的 25.12？**
25.12 换了新的 apk 包管理器，第三方中文插件（OpenClash/PassWall/SSR-Plus）适配还不成熟。24.10 是 opkg，生态最稳。想尝鲜可以把版本改成 `v25.12.5`，但插件大概率会有问题。

**Q：刷坏了怎么办？**
红米 AC2100 有"小米路由器修复工具"和 Breed 两种救砖方式，见 `docs/flashing.md` 最后一节。
