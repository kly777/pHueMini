// renderer.js - 渲染模块
module.exports = {
    renderResult(result, serverTimestamp) {
        // 【关键修复】转换时间戳单位（秒 → 毫秒）
        const serverTime = new Date(serverTimestamp * 1000);
        const renderStart = Date.now();
        console.log(`[RENDER] 开始渲染结果 (服务器时间: ${serverTime.toISOString()})`);

        const ctx = this.data.canvasCtx;
        const systemInfo = wx.getSystemInfoSync();

        // 清除上一帧
        ctx.clearRect(0, 0, systemInfo.windowWidth, systemInfo.windowHeight);
        // 重置所有变换（关键修复）
        ctx.setTransform(1, 0, 0, 1, 0, 0);

        // 绘制检测结果
        if (result.objects && Array.isArray(result.objects)) {
            console.log(`[RENDER] 检测到 ${result.objects.length} 个对象`);

            result.objects.forEach((obj, index) => {
                const x = obj.x * systemInfo.windowWidth;
                const y = obj.y * systemInfo.windowHeight;
                const w = obj.width * systemInfo.windowWidth;
                const h = obj.height * systemInfo.windowHeight;

                // 设置线宽和样式
                ctx.setLineWidth(2);
                ctx.setStrokeStyle(obj.confidence > 0.8 ? '#00ff00' : '#ffcc00');
                ctx.strokeRect(x - w / 2, y - h / 2, w, h);

                // 设置文字样式
                ctx.setFillStyle('#ffffff');
                ctx.setFontSize(20); // 显式设置字体大小
                const phText = obj.ph_value !== undefined ? `pH: ${obj.ph_value}` : '';
                const labelText = `${obj.label} ${(obj.confidence * 100).toFixed(0)}% ${phText}`;
                ctx.fillText(labelText, x - w / 2 + 5, y - h / 2 + 25);
            });
        }

        // 绘制性能指标
        ctx.setFillStyle('#00ff00');
        ctx.setFontSize(20);
        ctx.fillText(`FPS: ${this.data.stats.fps.toFixed(1)} | 延迟: ${this.data.stats.latency}ms`, 10, 30);

        ctx.draw();
    },

    clearCanvas() {
        console.log('[CANVAS] 清除画布');
        const ctx = this.data.canvasCtx;
        const systemInfo = wx.getSystemInfoSync();
        ctx.clearRect(0, 0, systemInfo.windowWidth, systemInfo.windowHeight);
        ctx.draw();
    }
};