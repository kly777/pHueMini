// realtime.js (修复版)
const websocketModule = require('./websocket.js');
const cameraModule = require('./camera.js');
const frameProcessorModule = require('./frameProcessor.js');
const rendererModule = require('./renderer.js');

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
        renderTimer: null,
        cameraReady: false,
        cameraContext: null
    },

    onReady() {
        console.group('监听页面初始化');
        console.log(`[INIT] 设备ID: ${this.data.deviceId}`);
        console.log(`[INIT] 目标帧率: 2 FPS, 帧间隔: 500ms`);
        console.log(`[INIT] 最大帧大小: 300.0 KB`);
        console.groupEnd();

        // 关键修复1：使用createSelectorQuery的正确作用域
        const ctx = wx.createCanvasContext('overlayCanvas', this); // 传入this上下文
        ctx.lineWidth = 2;
        ctx.font = '20px sans-serif';
        this.setData({ canvasCtx: ctx });
        console.log('[CANVAS] Canvas上下文初始化成功');

        // 初始化各模块
        cameraModule.initCameraContext.call(this);

        // 关键修复2：延迟初始化，确保camera节点已渲染
        wx.nextTick(() => {
            websocketModule.initWebSocket.call(this);
            cameraModule.checkCameraNode.call(this);
        });
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
            frameProcessorModule.captureLoop.call(this);
            wx.showToast({ title: '开始实时分析', icon: 'none', duration: 1500 });
        } else {
            // 【关键增强】双重停止保障
            this.setData({ isProcessing: false });
            
            // 立即停止捕获
            if (this.captureTimer) {
                clearInterval(this.captureTimer);
                this.captureTimer = null;
                console.log('[PROCESS] 捕获定时器已清除');
            }
            
            // 清除待处理帧和渲染
            if (this.renderTimer) {
                clearInterval(this.renderTimer);
                this.renderTimer = null;
                console.log('[PROCESS] 渲染定时器已清除');
            }
            rendererModule.clearCanvas.call(this);
            
            // 增强清理：确保不会继续处理
            if (this.data.socketTask) {
                this.data.socketTask.onMessage(() => {
                    console.log('[WS] 已停止，忽略后续消息');
                    return;
                });
            }
            
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

    // WebSocket 模块方法
    initWebSocket: websocketModule.initWebSocket,

    getSocketState: websocketModule.getSocketState,

    // Camera 模块方法
    checkCameraNode: cameraModule.checkCameraNode,

    captureCameraFrame: cameraModule.captureCameraFrame,

    cameraInitDone: cameraModule.cameraInitDone,

    cameraError: cameraModule.cameraError,

    // Frame Processor 模块方法
    captureLoop: frameProcessorModule.captureLoop,

    captureAndSendFrame: frameProcessorModule.captureAndSendFrame,

    updateStats: frameProcessorModule.updateStats,

    // Renderer 模块方法
    renderResult: rendererModule.renderResult,

    clearCanvas: rendererModule.clearCanvas,

    onUnload() {
        console.group('[LIFECYCLE] 页面卸载');
        console.log('- 停止实时处理');
        console.log(`- 最终状态: ${this.getSocketState()}`);
        console.log(`- 会话统计: 发送${this.data.stats.sentFrames || 0}帧, 接收${this.data.stats.receivedResults || 0}结果`);
        console.groupEnd();

        // 【关键增强】强制关闭所有处理
        this.setData({
            isProcessing: false,
            stats: {
                ...this.data.stats,
                sentFrames: this.data.stats.sentFrames || 0,
                receivedResults: this.data.stats.receivedResults || 0
            }
        });
        
        // 确保 WebSocket 关闭
        if (this.data.socketTask) {
            try {
                this.data.socketTask.close();
            } catch (e) {
                console.log('[WS] WebSocket 已关闭，无需重复操作');
            }
        }
        
        // 清理所有定时器
        [this.captureTimer, this.renderTimer].forEach(timer => {
            if (timer) {
                clearInterval(timer);
            }
        });
        
        console.log('[LIFECYCLE] 资源已完全释放');
    }
});