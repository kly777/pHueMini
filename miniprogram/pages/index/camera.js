// camera.js - 摄像头管理模块
const CAMERA_NODE_SELECTOR = '#realtime-camera'; // 使用ID选择器更可靠

module.exports = {
    initCameraContext() {
        const cameraContext = wx.createCameraContext();
        this.setData({ cameraContext });
        console.log('[CAMERA] 上下文创建成功');
    },

    checkCameraNode(retryCount = 0) {
        console.log(`[NODE] 开始检查camera节点 (重试次数: ${retryCount})`);
        // 如果 camera 上下文已存在且 cameraReady 为 true，则跳过检查
        if (this.data.cameraContext && this.data.cameraReady) {
            console.log('[NODE] 摄像头已就绪，跳过检查');
            return;
        }

        // 使用查询获取 camera 尺寸信息（可选）
        const query = wx.createSelectorQuery().in(this);
        query.select(CAMERA_NODE_SELECTOR).fields({
            node: true,
            size: true,
            rect: true
        }).exec((res) => {
            console.log('[NODE] 查询结果:', res);

            if (!res[0] || !res[0].node) {
                if (retryCount < 3) {
                    console.warn(`[NODE] 摄像头节点未就绪，${500}ms后重试 (${retryCount + 1}/3)`);
                    setTimeout(() => {
                        this.checkCameraNode(retryCount + 1);
                    }, 500);
                    return;
                }
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
            // 设置 cameraReady 标志
            this.setData({ cameraReady: true });
        });
    },

    async captureCameraFrame() {
        return new Promise((resolve, reject) => {
            console.log('[CAPTURE] 开始帧捕获流程（使用拍照）');
            const cameraContext = this.data.cameraContext;
            if (!cameraContext) {
                reject(new Error('摄像头上下文未初始化'));
                return;
            }

            cameraContext.takePhoto({
                quality: 'low', // 低质量以减小尺寸
                success: (res) => {
                    console.log('[CAPTURE] 拍照成功，临时文件路径:', res.tempImagePath);
                    wx.getFileSystemManager().readFile({
                        filePath: res.tempImagePath,
                        success: ({ data }) => {
                            console.log(`[CAPTURE] 读取文件成功，大小: ${data.byteLength} 字节`);
                            resolve(data);
                        },
                        fail: (err) => reject(new Error(`读取照片失败: ${err.errMsg}`))
                    });
                },
                fail: (err) => {
                    console.error('[CAPTURE] 拍照失败', err);
                    reject(new Error(`拍照失败: ${err.errMsg}`));
                }
            });
        });
    },

    cameraInitDone(e) {
        console.log('[CAMERA] 初始化完成', e.detail);
        this.setData({ cameraReady: true });
        // 重新检查节点
        this.checkCameraNode();
    },

    cameraError(e) {
        console.error('[CAMERA] 初始化失败', e.detail);
        wx.showToast({ title: '相机错误: ' + e.detail, icon: 'error', duration: 3000 });
        this.setData({ isProcessing: false });
    }
};