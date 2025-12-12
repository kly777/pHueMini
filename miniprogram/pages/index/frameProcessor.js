// frameProcessor.js - 帧处理和统计模块（优化版）
const FPS = 2; // 目标帧率
const FRAME_INTERVAL = 1000 / FPS;
const MAX_FRAME_SIZE = 300 * 1024;
const LOG_FRAME_INTERVAL = 5;
const MAX_PENDING_FRAMES = 2; // 最大未处理帧数

module.exports = {
    captureLoop() {
        console.log('[CAPTURE] 启动捕获循环（优化版）');

        // 清除可能存在的旧定时器
        if (this.captureTimer) {
            clearTimeout(this.captureTimer);
            this.captureTimer = null;
        }

        // 初始化 pending frames 计数器
        if (typeof this.pendingFrames === 'undefined') {
            this.pendingFrames = 0;
        }

        // 使用递归 setTimeout 避免累积延迟
        const scheduleNextFrame = () => {
            if (!this.data.isProcessing || !this.data.socketTask) {
                console.log('[CAPTURE] 检测到停止请求或连接断开，停止捕获循环');
                this.captureTimer = null;
                return;
            }

            // 检查是否有太多未处理帧
            if (this.pendingFrames >= MAX_PENDING_FRAMES) {
                console.warn(`[CAPTURE] 未处理帧过多 (${this.pendingFrames}/${MAX_PENDING_FRAMES})，延迟下一帧`);
                this.captureTimer = setTimeout(scheduleNextFrame, 100);
                return;
            }

            const now = Date.now();
            const elapsed = now - this.data.lastCaptureTime;

            // 严格控制帧率
            if (elapsed < FRAME_INTERVAL) {
                this.captureTimer = setTimeout(scheduleNextFrame, FRAME_INTERVAL - elapsed);
                return;
            }

            this.setData({ lastCaptureTime: now });
            this.captureAndSendFrame().finally(() => {
                // 无论成功与否，都调度下一帧
                this.captureTimer = setTimeout(scheduleNextFrame, FRAME_INTERVAL);
            });
        };

        // 启动第一帧
        this.captureTimer = setTimeout(scheduleNextFrame, 0);
    },

    async captureAndSendFrame() {
        if (!this.data.isProcessing || !this.data.socketTask) {
            console.warn('[CAPTURE] 捕获条件不满足，跳过帧');
            return;
        }

        // 增加 pending frames 计数
        this.pendingFrames = (this.pendingFrames || 0) + 1;
        const frameIndex = (this.data.stats.sentFrames || 0) + 1;
        const captureStart = Date.now();
        const frameId = Date.now(); // 用于跟踪往返时间

        try {
            console.log(`[FRAME] #${frameIndex} 开始捕获 (ID: ${frameId})`);
            const frameData = await this.captureCameraFrame();
            const captureEnd = Date.now();

            if (!frameData) {
                console.error(`[FRAME] #${frameIndex} 捕获失败: 无帧数据`);
                this.pendingFrames--;
                return;
            }

            const frameSize = frameData.byteLength;
            const captureTime = captureEnd - captureStart;
            console.log(`[FRAME] #${frameIndex} 捕获成功 (耗时: ${captureTime}ms, 大小: ${(frameSize / 1024).toFixed(1)}KB)`);

            if (frameSize > MAX_FRAME_SIZE) {
                console.warn(`[FRAME] #${frameIndex} 帧过大 (${(frameSize / 1024).toFixed(1)}KB > ${(MAX_FRAME_SIZE / 1024).toFixed(1)}KB)，跳过发送`);
                this.pendingFrames--;
                return;
            }

            // 存储发送时间用于延迟计算
            if (!this.frameTimestamps) {
                this.frameTimestamps = new Map();
            }
            this.frameTimestamps.set(frameId, {
                sentTime: Date.now(),
                captureStart,
                captureTime
            });

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
                    this.pendingFrames--;
                    this.frameTimestamps.delete(frameId);
                    
                    if (err.errMsg.includes('state:3') || err.errMsg.includes('closed')) {
                        console.error('[WS] 连接已关闭，停止处理');
                        this.setData({ isProcessing: false });
                        if (this.captureTimer) {
                            clearTimeout(this.captureTimer);
                            this.captureTimer = null;
                        }
                    }
                }
            });

            // 更新统计
            this.setData(prev => ({
                stats: {
                    ...prev.stats,
                    sentFrames: (prev.stats.sentFrames || 0) + 1
                }
            }));

        } catch (e) {
            console.error(`[FRAME] #${frameIndex} 捕获异常`, e);
            this.pendingFrames--;
            if (e.message?.includes('context')) {
                console.error('[FRAME] 摄像头上下文错误，尝试重新获取节点');
            }
        }
    },

    updateStats(serverLatency, frameId) {
        const now = Date.now();
        
        // 计算端到端延迟
        let totalLatency = serverLatency;
        if (frameId && this.frameTimestamps && this.frameTimestamps.has(frameId)) {
            const timestamp = this.frameTimestamps.get(frameId);
            totalLatency = now - timestamp.sentTime + serverLatency;
            this.frameTimestamps.delete(frameId); // 清理
            this.pendingFrames = Math.max(0, (this.pendingFrames || 0) - 1);
        }

        // 每秒计算一次FPS
        if (!this.data.lastStatsUpdate || now - this.data.lastStatsUpdate >= 1000) {
            // 使用时间窗口计算实际FPS
            const timeWindow = now - this.data.lastStatsUpdate;
            const framesInWindow = this.data.stats.sentFrames - (this.data.lastSentFrames || 0);
            const actualFPS = timeWindow > 0 ? (framesInWindow * 1000) / timeWindow : 0;

            // 更新基准
            this.lastSentFrames = this.data.stats.sentFrames;
            
            this.setData({
                stats: {
                    ...this.data.stats,
                    fps: actualFPS,
                    latency: Math.min(totalLatency, 2000) // 限制最大显示延迟
                },
                lastStatsUpdate: now
            });

            console.log(`[STATS] 每秒统计: FPS=${actualFPS.toFixed(1)}, 延迟=${totalLatency.toFixed(1)}ms, 待处理帧=${this.pendingFrames || 0}`);
        }
    }
};