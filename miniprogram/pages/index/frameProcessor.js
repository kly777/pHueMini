// frameProcessor.js - 帧处理和统计模块
const FPS = 2;
const FRAME_INTERVAL = 1000 / FPS;
const MAX_FRAME_SIZE = 300 * 1024;
const LOG_FRAME_INTERVAL = 5;

module.exports = {
    captureLoop() {
        console.log('[CAPTURE] 启动捕获循环');

        // 清除可能存在的旧定时器
        if (this.captureTimer) {
            clearInterval(this.captureTimer);
            this.captureTimer = null;
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
                data: frameData,
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
            }
        }
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
    }
};