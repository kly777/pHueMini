// websocket.js - WebSocket 连接管理模块
const FPS = 2;
const FRAME_INTERVAL = 1000 / FPS;

module.exports = {
    initWebSocket() {
        // 关键修复3：动态判断环境，使用正确的协议
        const isDevTools = wx.getSystemInfoSync().platform === 'devtools';
        const protocol = isDevTools ? 'ws' : 'wss';
        const domain = isDevTools ? 'localhost:8000' : 'kly.life';

        const wsUrl = `${protocol}://${domain}/ws/realtime?device_id=${this.data.deviceId}`;
        console.log(`[WS] 尝试连接: ${wsUrl} (开发工具: ${isDevTools})`);

        // 关键修复4：添加连接选项
        const socketTask = wx.connectSocket({
            url: wsUrl,
            tcpNoDelay: true // 优化实时通信
        });

        socketTask.onOpen(() => {
            console.group('[WS] 连接成功');
            console.log(`- 连接地址: ${wsUrl}`);
            console.log(`- 设备ID: ${this.data.deviceId}`);
            console.groupEnd();

            wx.showToast({ title: '连接成功', icon: 'success' });
            this.setData({ socketTask });
        });

        socketTask.onMessage((res) => {
            // 【关键修复】立即检查处理状态，防止停止后继续处理
            if (!this.data.isProcessing) {
                console.log('[WS] 忽略消息：已停止处理');
                return;
            }
    
            const now = Date.now();
            const msgSize = res.data?.length || 0;
    
            try {
                const data = JSON.parse(res.data);
                console.log(`[WS] ← 接收消息 (${msgSize}字节)`, {
                    type: data.type,
                    timestamp: data.timestamp,
                    latency: data.latency?.total
                });
    
                if (data.type === 'result') {
                    // 再次验证（双重保险）
                    if (!this.data.isProcessing) {
                        console.log('[WS] 忽略结果：已停止处理');
                        return;
                    }
    
                    this.setData(prev => ({
                        stats: { ...prev.stats, receivedResults: prev.stats.receivedResults + 1 }
                    }));
                    this.renderResult(data.payload, data.timestamp);
                    
                    // 获取最近发送的帧ID用于延迟计算
                    let frameId = null;
                    if (this.frameTimestamps && this.frameTimestamps.size > 0) {
                        // 使用最早发送的帧（FIFO）
                        const entries = Array.from(this.frameTimestamps.entries());
                        if (entries.length > 0) {
                            frameId = entries[0][0]; // 第一个键
                        }
                    }
                    
                    this.updateStats(data.latency?.total || 0, frameId);
                }
            } catch (e) {
                console.error('[WS] 消息解析失败', e, '原始数据:', res.data);
            }
        });

        socketTask.onError((err) => {
            console.error('[WS] 连接错误', {
                errMsg: err.errMsg,
                timestamp: new Date().toISOString()
            });

            let errMsg = '网络连接失败';
            if (err.errMsg.includes('url not in domain list')) {
                errMsg = isDevTools
                    ? '请开启开发者工具的"不校验合法域名"选项'
                    : '安全限制：未配置合法域名';
            }

            wx.showToast({
                title: errMsg,
                icon: 'error',
                duration: 3000,
                success: () => {
                    if (!isDevTools && errMsg.includes('未配置合法域名')) {
                        setTimeout(() => {
                            wx.openSetting({
                                success: (res) => {
                                    console.log('用户打开设置面板', res);
                                }
                            });
                        }, 3000);
                    }
                }
            });
            this.setData({ isProcessing: false });
        });

        socketTask.onClose((res) => {
            console.warn('[WS] 连接关闭', {
                code: res.code,
                reason: res.reason,
                wasClean: res.wasClean,
                timestamp: new Date().toISOString()
            });

            if (this.data.isProcessing) {
                this.setData({ isProcessing: false });
                wx.showToast({ title: '连接已断开', icon: 'none', duration: 2000 });
            }
        });

        // 设置连接超时
        setTimeout(() => {
            if (!this.data.socketTask) {
                console.error('[WS] 连接超时 (5秒)');
                wx.showToast({ title: '连接超时', icon: 'error' });
            }
        }, 5000);

        return socketTask;
    },

    getSocketState() {
        if (!this.data.socketTask) return '未初始化';

        switch (this.data.socketTask.readyState) {
            case 0: return '连接中';
            case 1: return '已打开';
            case 2: return '关闭中';
            case 3: return '已关闭';
            default: return '未知状态';
        }
    }
};