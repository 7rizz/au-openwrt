# 红米 AC2100 刷机与救砖

> 刷机有风险。请先看完一遍再动手，并保证刷机过程中**不要断电**。

## 0. 文件说明

红米 AC2100 的 OpenWrt 固件有 4 个文件，作用不同：

| 文件 | 用途 |
| --- | --- |
| `*-initramfs-kernel.bin` | 临时内存系统，用来"先跑起来再刷正式固件"，最安全 |
| `*-squashfs-kernel1.bin` | 正式固件的**内核**部分，写入 `kernel` 分区 |
| `*-squashfs-rootfs0.bin` | 正式固件的**系统**部分，写入 `ubi` 分区 |
| `*-squashfs-sysupgrade.bin` | 升级包；在 OpenWrt 系统里升级时用这个 |

设备分区（来自 OpenWrt 设备树，已核实）：

```
Bootloader  0x000000  512K   原厂 U-Boot
Config      0x080000  256K
Bdata       0x0C0000  256K
factory     0x100000  256K   无线校准数据（千万别动）
crash       0x140000  256K
crash_syslog 0x180000 256K
reserved0   0x1C0000  256K
kernel_stock 0x200000 4M     原厂内核（保留）
kernel      0x600000  4M     ← OpenWrt 内核写这里
ubi         0xA00000  117.5M ← OpenWrt 系统写这里
```

---

## 1. 让原厂系统能 SSH 登录

红米 AC2100 的原厂固件不开放 SSH，需要用已知漏洞开启（网上叫"AC2100 免拆机开 SSH"）。要点：

- 到小米官网下载**较老版本**的原厂固件（新版本可能已修漏洞），先在原厂后台刷成老版本；
- 用社区流传的开启脚本/工具（原理：通过原厂 Web 接口的未授权命令执行）拿到 root 的 SSH；
- 登录确认：`ssh root@192.168.31.1`（原厂默认网关是 `192.168.31.1`）。

如果不想折腾这一步，可以跳过，看第 5 节"用 Breed 引导"。

---

## 2. 写入 OpenWrt（方式 A，推荐）

在**原厂系统的 SSH 里**执行（把文件名换成你实际下载的）：

```sh
cd /tmp
# 用 WinSCP / scp 把这两个文件传上来，或路由器能上网时直接 wget

# 1) 写入内核（4MB 分区，文件约 3MB）
mtd write openwrt-24.10.8-ramips-mt7621-xiaomi_redmi-router-ac2100-squashfs-kernel1.bin kernel

# 2) 写入系统（117MB 的 ubi 分区）
mtd write openwrt-24.10.8-ramips-mt7621-xiaomi_redmi-router-ac2100-squashfs-rootfs0.bin ubi

# 3) 重启
reboot
```

重启后，把电脑网线插到路由器的 LAN 口，等 1~2 分钟：

- 看到 OpenWrt 的默认 WiFi（SSID `OpenWrt`）或
- 浏览器访问 `192.168.1.1` 能进 LuCI 后台

就说明 OpenWrt 已经跑起来了。

> 注意：此时是**官方原版 OpenWrt**（`192.168.1.1`，无密码）。下一步再刷你自己编译的私人固件。

---

## 3. 刷入你的私人固件

进 LuCI 后台（`http://192.168.1.1`）：

1. 先设置 root 密码（系统 → 管理权）；
2. **系统 → 备份/刷写固件 → 刷写固件**，选择你从 GitHub Actions 下载的
   `openwrt-24.10.8-ramips-mt7621-xiaomi_redmi-router-ac2100-squashfs-sysupgrade.bin`
   （**不要勾**"保留配置"，第一次刷建议全新）；
3. 等 2~3 分钟自动重启。

重启后：

- 后台地址是 `192.168.1.1`
- 登录密码 `root`
- WiFi：2.4G `破解校园网V：aauuo0` / 5G `破解校园网联系v：aauuo0`，密码 `aaaauuuu`（刷完自动开启，不用手动开）
- 如果第一次开机 WiFi 没起来，**再重启一次**即可（第一次会自动配置无线）。

以后升级固件，直接在 LuCI 里刷 `sysupgrade.bin` 就行，也可以选择保留配置。

---

## 4. 命令行方式（可选）

已经能 SSH 进 OpenWrt 的话，也可以直接：

```sh
cd /tmp
sysupgrade -n /tmp/openwrt-24.10.8-ramips-mt7621-xiaomi_redmi-router-ac2100-squashfs-sysupgrade.bin
```

`-n` 表示不保留配置（第一次刷建议加，之后想保留配置就去掉 `-n`）。

---

## 5. 备用方案：用 Breed 引导刷机

如果你不想碰原厂漏洞，或者已经把 Bootloader 换成了 **Breed**（社区常见的
`breed-mt7621-xiaomi-r3g.bin`，红米 AC2100 通用）：

1. 断电，按住机身 reset 键插电，等指示灯闪烁后松开；
2. 电脑设成静态地址 `192.168.1.1`，浏览器访问 `http://192.168.1.1` 进 Breed 控制台；
3. **固件更新 → 选择固件**，选择你的 `sysupgrade.bin`，点上传刷写；
4. 完成后断电重插即可。

Breed 的好处是**永远刷不死**，随时可以进控制台恢复。

---

## 6. 救砖

### 情况一：还能进 Breed
直接进 Breed 控制台重新刷固件即可（见上一节）。

### 情况二：完全进不去
1. **小米路由器修复工具**（小米官方）：到小米官网下载该工具 + 红米 AC2100 的原厂固件，
   按工具提示用网线连接路由器，可恢复原厂系统；
2. 如果原厂修复工具也不行（Bootloader 被覆盖/损坏），就需要**拆机接 UART/编程器**刷回
   Bootloader 了，这种属于硬件级救援。

> 保留原厂 `kernel_stock` 分区的好处就是：不要主动去写 `Bootloader` 和 `factory` 分区，
> 刷错系统一般都能通过上面的方式救回来。

---

## 7. 校验下载的文件

Windows 上校验（PowerShell）：

```powershell
Get-FileHash .\openwrt-24.10.8-ramips-mt7621-xiaomi_redmi-router-ac2100-squashfs-sysupgrade.bin -Algorithm SHA256
```

把结果和同目录 `sha256sums` 里对应那一行对比，一致才刷。
