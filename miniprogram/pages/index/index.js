// realtime.js (修复版)
const FPS = 10;
const FRAME_INTERVAL = 1000 / FPS;
const MAX_FRAME_SIZE = 300 * 1024;
const LOG_FRAME_INTERVAL = 5;
const CAMERA_NODE_SELECTOR = '#realtime-camera'; // 使用ID选择器更可靠

Page({
    data: {
        isProcessing: false,
        socketTask: null,
        deviceId: wx.getStorageSync('deviceId') || Date.now().toString(36),
        lastCaptureTime: 0,
        stats: {
            fps: 0,
            latency: 0,
            frameCount: 0,
            sentFrames: 0,
            receivedResults: 0
        },
        lastRenderTime: 0,
        lastLogTime: 0,
        lastStatsUpdate: 0,
        captureTimer: null,
        renderTimer: null
    },

    onReady() {
        console.group('监听页面初始化');
        console.log(`[INIT] 设备ID: ${this.data.deviceId}`);
        console.log(`[INIT] 目标帧率: ${FPS} FPS, 帧间隔: ${FRAME_INTERVAL}ms`);
        console.log(`[INIT] 最大帧大小: ${(MAX_FRAME_SIZE / 1024).toFixed(1)} KB`);
        console.groupEnd();

        // 关键修复1：使用createSelectorQuery的正确作用域
        const ctx = wx.createCanvasContext('overlayCanvas', this); // 传入this上下文
        ctx.lineWidth = 2;
        ctx.font = '14px sans-serif';
        this.setData({ canvasCtx: ctx });
        console.log('[CANVAS] Canvas上下文初始化成功');

        // 关键修复2：延迟初始化，确保camera节点已渲染
        wx.nextTick(() => {
            this.initWebSocket();
            this.checkCameraNode(); // 添加节点检查
        });
    },

    // 新增：检查camera节点是否可用
    checkCameraNode() {
        console.log('[NODE] 开始检查camera节点');
        const query = wx.createSelectorQuery().in(this); // 指定在当前页面上下文中

        query.select(CAMERA_NODE_SELECTOR).fields({
            node: true,
            size: true,
            rect: true
        }).exec((res) => {
            console.log('[NODE] 查询结果:', res);

            if (!res[0] || !res[0].node) {
                console.error('[NODE] 严重错误：无法获取camera节点，页面结构可能有问题');
                wx.showModal({
                    title: '摄像头初始化失败',
                    content: '无法访问摄像头，请尝试重启小程序或检查权限设置',
                    showCancel: false,
                    success: () => {
                        wx.navigateBack();
                    }
                });
                return;
            }

            console.log(`[NODE] 摄像头节点可用，尺寸: ${res[0].width}x${res[0].height}`);
            console.log(`[NODE] 节点位置:`, res[0]);
        });
    },

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
                    this.setData(prev => ({
                        stats: { ...prev.stats, receivedResults: prev.stats.receivedResults + 1 }
                    }));
                    this.renderResult(data.payload, data.timestamp);
                    this.updateStats(data.latency?.total || 0);
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
    },

    toggleProcessing() {
        const newState = !this.data.isProcessing;
        const action = newState ? '启动' : '停止';

        console.group(`[PROCESS] ${action}实时分析`);
        console.log(`- 当前状态: ${this.data.isProcessing} → ${newState}`);
        console.log(`- WebSocket状态: ${this.getSocketState()}`);
        console.groupEnd();

        this.setData({ isProcessing: newState });

        if (newState) {
            // 确保WebSocket已连接
            if (!this.data.socketTask || this.data.socketTask.readyState !== 1) {
                console.warn('[PROCESS] WebSocket未就绪，等待重试');
                wx.showToast({ title: '等待连接中...', icon: 'loading' });
                setTimeout(() => this.toggleProcessing(), 500);
                return;
            }

            // 重置统计
            this.setData({
                stats: {
                    fps: 0,
                    latency: 0,
                    frameCount: 0,
                    sentFrames: 0,
                    receivedResults: 0
                },
                lastCaptureTime: Date.now(),
                lastLogTime: Date.now(),
                lastStatsUpdate: Date.now()
            });

            console.log('[PROCESS] 重置统计数据，启动捕获循环');
            this.captureLoop();
            wx.showToast({ title: '开始实时分析', icon: 'none', duration: 1500 });
        } else {
            // 停止所有循环
            if (this.captureTimer) {
                clearInterval(this.captureTimer);
                this.captureTimer = null;
                console.log('[PROCESS] 捕获定时器已清除');
            }
            if (this.renderTimer) {
                clearInterval(this.renderTimer);
                this.renderTimer = null;
                console.log('[PROCESS] 渲染定时器已清除');
            }
            this.clearCanvas();
            wx.showToast({ title: '已停止分析', icon: 'none', duration: 1000 });

            // 打印最终统计
            console.group('[STATS] 会话统计');
            console.log(`- 总发送帧数: ${this.data.stats.sentFrames}`);
            console.log(`- 总接收结果: ${this.data.stats.receivedResults}`);
            console.log(`- 平均FPS: ${this.data.stats.fps.toFixed(1)}`);
            console.log(`- 平均延迟: ${this.data.stats.latency.toFixed(1)}ms`);
            console.groupEnd();
        }
    },

    captureLoop() {
        console.log('[CAPTURE] 启动捕获循环');

        // 清除可能存在的旧定时器
        if (this.captureTimer) {
            clearInterval(this.captureTimer);
        }

        this.captureTimer = setInterval(() => {
            if (!this.data.isProcessing || !this.data.socketTask) {
                console.log('[CAPTURE] 检测到停止请求或连接断开，清除定时器');
                clearInterval(this.captureTimer);
                this.captureTimer = null;
                return;
            }

            const now = Date.now();
            const elapsed = now - this.data.lastCaptureTime;

            // 严格控制帧率
            if (elapsed < FRAME_INTERVAL) {
                return;
            }

            this.setData({ lastCaptureTime: now });
            this.captureAndSendFrame();
        }, 40); // 40ms 检查间隔，足够捕捉10fps
    },

    async captureAndSendFrame() {
        if (!this.data.isProcessing || !this.data.socketTask) {
            console.warn('[CAPTURE] 捕获条件不满足，跳过帧');
            return;
        }

        const frameIndex = this.data.stats.sentFrames + 1;
        const captureStart = Date.now();

        try {
            console.log(`[FRAME] #${frameIndex} 开始捕获`);
            const frameData = await this.captureCameraFrame();
            const captureEnd = Date.now();

            if (!frameData) {
                console.error(`[FRAME] #${frameIndex} 捕获失败: 无帧数据`);
                return;
            }

            const frameSize = frameData.byteLength;
            console.log(`[FRAME] #${frameIndex} 捕获成功 (耗时: ${captureEnd - captureStart}ms, 大小: ${(frameSize / 1024).toFixed(1)}KB)`);

            if (frameSize > MAX_FRAME_SIZE) {
                console.warn(`[FRAME] #${frameIndex} 帧过大 (${(frameSize / 1024).toFixed(1)}KB > ${(MAX_FRAME_SIZE / 1024).toFixed(1)}KB)，跳过发送`);
                return;
            }

            // 发送帧数据
            this.data.socketTask.send({
                frameData,
                success: () => {
                    if (frameIndex % LOG_FRAME_INTERVAL === 0) {
                        console.log(`[WS] → 帧 #${frameIndex} 发送成功`);
                    }
                },
                fail: (err) => {
                    console.error(`[WS] → 帧 #${frameIndex} 发送失败`, err);
                    if (err.errMsg.includes('state:3') || err.errMsg.includes('closed')) {
                        console.error('[WS] 连接已关闭，停止处理');
                        this.setData({ isProcessing: false });
                        if (this.captureTimer) {
                            clearInterval(this.captureTimer);
                            this.captureTimer = null;
                        }
                    }
                }
            });

            // 更新统计
            this.setData(prev => ({
                stats: {
                    ...prev.stats,
                    frameCount: prev.stats.frameCount + 1,
                    sentFrames: prev.stats.sentFrames + 1
                }
            }));

        } catch (e) {
            console.error(`[FRAME] #${frameIndex} 捕获异常`, e);
            if (e.message?.includes('context')) {
                console.error('[FRAME] 摄像头上下文错误，尝试重新获取节点');
                // 可选：添加重试机制
            }
        }
    },

    async captureCameraFrame() {
        return new Promise((resolve, reject) => {
            console.log('[CAPTURE] 开始帧捕获流程');

            // 关键修复5：使用正确的查询上下文
            const query = wx.createSelectorQuery().in(this);
            const systemInfo = wx.getSystemInfoSync();

            query.select(CAMERA_NODE_SELECTOR).fields({
                node: true,
                size: true
            }).exec((res) => {
                if (!res[0] || !res[0].node) {
                    console.error('[CAPTURE] 节点查询失败，结果为空', res);

                    // 关键修复6：提供详细的错误上下文
                    wx.createSelectorQuery().in(this).selectAll('*').boundingClientRect().exec((allNodes) => {
                        console.log('[DEBUG] 页面所有节点:', allNodes);
                    });

                    reject(new Error('无法获取摄像头节点，请检查页面结构和权限'));
                    return;
                }

                const cameraNode = res[0].node;
                console.log(`[CAPTURE] 摄像头节点尺寸: ${cameraNode.width}x${cameraNode.height}`);

                try {
                    // 关键修复7：检查节点类型
                    if (typeof cameraNode.requestFrame !== 'function') {
                        console.error('[CAPTURE] 节点不是有效的camera节点，类型:', typeof cameraNode);
                        reject(new Error('无效的摄像头节点类型'));
                        return;
                    }

                    // 创建离屏Canvas，使用屏幕实际尺寸
                    const canvas = wx.createOffscreenCanvas({
                        type: '2d',
                        width: systemInfo.windowWidth,
                        height: systemInfo.windowHeight
                    });
                    const ctx = canvas.getContext('2d');

                    // 绘制当前帧
                    if (cameraNode.width && cameraNode.height) {
                        const camRatio = cameraNode.width / cameraNode.height;
                        const screenRatio = systemInfo.windowWidth / systemInfo.windowHeight;

                        let drawWidth, drawHeight, offsetX = 0, offsetY = 0;

                        if (camRatio > screenRatio) {
                            // 摄像头更宽
                            drawHeight = systemInfo.windowHeight;
                            drawWidth = systemInfo.windowHeight * camRatio;
                            offsetX = (systemInfo.windowWidth - drawWidth) / 2;
                        } else {
                            // 摄像头更高
                            drawWidth = systemInfo.windowWidth;
                            drawHeight = systemInfo.windowWidth / camRatio;
                            offsetY = (systemInfo.windowHeight - drawHeight) / 2;
                        }

                        ctx.drawImage(cameraNode, offsetX, offsetY, drawWidth, drawHeight);
                    } else {
                        // 备用方案
                        ctx.drawImage(cameraNode, 0, 0, systemInfo.windowWidth, systemInfo.windowHeight);
                    }

                    // 转换为压缩的JPG
                    canvas.toTempFilePath({
                        quality: 0.6,
                        success: ({ tempFilePath }) => {
                            wx.getFileSystemManager().readFile({
                                filePath: tempFilePath,
                                success: ({ data }) => resolve(data),
                                fail: (err) => reject(new Error(`读取帧失败: ${err.errMsg}`))
                            });
                        },
                        fail: (err) => reject(new Error(`截图失败: ${err.errMsg}`))
                    });
                } catch (e) {
                    console.error('[CAPTURE] 处理异常', e);
                    reject(e);
                }
            });
        });
    },

    renderResult(result, serverTimestamp) {
        const renderStart = Date.now();
        console.log(`[RENDER] 开始渲染结果 (服务器时间: ${new Date(serverTimestamp).toISOString()})`);

        const ctx = this.data.canvasCtx;
        const systemInfo = wx.getSystemInfoSync();

        // 清除上一帧
        ctx.clearRect(0, 0, systemInfo.windowWidth, systemInfo.windowHeight);

        // 绘制检测结果
        if (result.objects && Array.isArray(result.objects)) {
            console.log(`[RENDER] 检测到 ${result.objects.length} 个对象`);

            result.objects.forEach((obj, index) => {
                const x = obj.x * systemInfo.windowWidth;
                const y = obj.y * systemInfo.windowHeight;
                const w = obj.width * systemInfo.windowWidth;
                const h = obj.height * systemInfo.windowHeight;

                ctx.setStrokeStyle(obj.confidence > 0.8 ? '#00ff00' : '#ffcc00');
                ctx.strokeRect(x - w / 2, y - h / 2, w, h);

                ctx.setFillStyle('#ffffff');
                ctx.fillText(`${obj.label} ${(obj.confidence * 100).toFixed(0)}%`, x - w / 2 + 5, y - h / 2 + 18);
            });
        }

        // 绘制性能指标
        ctx.setFillStyle('#00ff00');
        ctx.setFontSize(14);
        ctx.fillText(`FPS: ${this.data.stats.fps.toFixed(1)} | 延迟: ${this.data.stats.latency}ms`, 10, 30);

        ctx.draw();
    },

    updateStats(serverLatency) {
        const now = Date.now();
        const totalLatency = now - this.data.lastCaptureTime + serverLatency;

        // 每秒计算一次FPS
        if (!this.lastStatsUpdate || now - this.lastStatsUpdate >= 1000) {
            const actualFPS = this.data.stats.frameCount;

            this.setData({
                stats: {
                    fps: actualFPS,
                    latency: Math.min(totalLatency, 1000),
                    frameCount: 0
                }
            });

            this.lastStatsUpdate = now;
            console.log(`[STATS] 每秒统计: FPS=${actualFPS}, 延迟=${totalLatency.toFixed(1)}ms`);
        }
    },

    clearCanvas() {
        console.log('[CANVAS] 清除画布');
        const ctx = this.data.canvasCtx;
        const systemInfo = wx.getSystemInfoSync();
        ctx.clearRect(0, 0, systemInfo.windowWidth, systemInfo.windowHeight);
        ctx.draw();
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
    },

    cameraError(e) {
        console.error('[CAMERA] 初始化失败', e.detail);
        wx.showToast({ title: '相机错误: ' + e.detail, icon: 'error', duration: 3000 });
        this.setData({ isProcessing: false });
    },

    onUnload() {
        console.group('[LIFECYCLE] 页面卸载');
        console.log('- 停止实时处理');
        console.log(`- 最终状态: ${this.getSocketState()}`);
        console.log(`- 会话统计: 发送${this.data.stats.sentFrames}帧, 接收${this.data.stats.receivedResults}结果`);
        console.groupEnd();

        this.setData({ isProcessing: false });
        if (this.captureTimer) {
            clearInterval(this.captureTimer);
            this.captureTimer = null;
        }
        if (this.data.socketTask) {
            this.data.socketTask.close();
            console.log('[WS] 主动关闭WebSocket连接');
        }
    }
});