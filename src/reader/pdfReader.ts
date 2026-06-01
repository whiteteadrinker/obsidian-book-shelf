/**
 * PDF 阅读器
 * 使用 pdf.js 逐页渲染 PDF 到 canvas
 */
export interface PdfReaderState {
    /** 当前页码 (1-based) */
    currentPage: number;
    /** 总页数 */
    totalPages: number;
    /** 缩放比例 */
    scale: number;
    /** PDF 文档对象 */
    pdfDoc: any;
    /** 渲染 canvas 的容器 */
    container: HTMLElement;
}

/**
 * 加载 PDF 文档
 */
export async function loadPdfDocument(buffer: ArrayBuffer): Promise<any> {
    const pdfjsLib = await import('pdfjs-dist');

    const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(buffer),
        disableWorker: true,
    } as any);
    const pdfDoc = await loadingTask.promise;
    return pdfDoc;
}

/**
 * 渲染 PDF 的某一页到 canvas
 */
export async function renderPdfPage(
    pdfDoc: any,
    pageNumber: number,
    container: HTMLElement,
    scale: number = 1.2
): Promise<{ canvas: HTMLCanvasElement; textContent: any } | null> {
    try {
        // 清理旧内容
        container.empty();

        const page = await pdfDoc.getPage(pageNumber);
        const viewport = page.getViewport({ scale });

        // 创建 canvas
        const canvas = container.createEl('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.display = 'block';
        canvas.style.margin = '0 auto';
        canvas.addClass('bookshelf-pdf-page');

        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        // 渲染页面
        await page.render({
            canvasContext: ctx,
            viewport: viewport,
        }).promise;

        // 获取文本内容（用于选择和标注）
        const textContent = await page.getTextContent();

        // 可选：渲染文本层用于选择和标注
        renderTextLayer(page, viewport, container, textContent);

        return { canvas, textContent };
    } catch (error) {
        console.error(`Failed to render PDF page ${pageNumber}:`, error);
        return null;
    }
}

/**
 * 在 PDF 页面上方渲染透明文本层（用于文本选择）
 */
function renderTextLayer(
    page: any,
    viewport: any,
    container: HTMLElement,
    textContent: any
): void {
    try {
        const textLayerDiv = container.createDiv();
        textLayerDiv.style.position = 'absolute';
        textLayerDiv.style.left = '0';
        textLayerDiv.style.top = '0';
        textLayerDiv.style.width = `${viewport.width}px`;
        textLayerDiv.style.height = `${viewport.height}px`;
        textLayerDiv.style.pointerEvents = 'auto';
        textLayerDiv.style.color = 'transparent';
        textLayerDiv.style.userSelect = 'text';
        textLayerDiv.style.lineHeight = '1';
        textLayerDiv.style.overflow = 'hidden';

        // 设置 container 为 relative 定位
        container.style.position = 'relative';
        container.style.display = 'inline-block';
        container.style.margin = '0 auto';
        container.style.maxWidth = '100%';

        const textContentStyle = textContent.styles || {};

        for (const textItem of textContent.items) {
            if (!textItem.str) continue;

            const tx = pdfjsLib.Util.transform(
                viewport.transform,
                textItem.transform
            );
            const style = textContentStyle[textItem.fontName] || {};

            const span = textLayerDiv.createEl('span');
            span.setText(textItem.str);
            span.style.position = 'absolute';
            span.style.left = `${tx[4]}px`;
            span.style.top = `${tx[5] - textItem.height}px`;
            span.style.fontSize = `${Math.abs(textItem.height) * 0.9}px`;
            span.style.fontFamily = style.fontFamily || 'sans-serif';
            span.style.color = 'transparent';
            span.style.userSelect = 'text';
            span.style.whiteSpace = 'pre';
            span.style.pointerEvents = 'auto';
        }
    } catch {
        // 文本层是可选的，渲染失败不影响阅读
    }
}

// pdfjsLib 引用（在 renderTextLayer 中使用）
const pdfjsLib = {
    Util: {
        transform: function (transform1: number[], transform2: number[]): number[] {
            // pdf.js transform 矩阵乘法
            return [
                transform1[0] * transform2[0] + transform1[2] * transform2[1],
                transform1[1] * transform2[0] + transform1[3] * transform2[1],
                transform1[0] * transform2[2] + transform1[2] * transform2[3],
                transform1[1] * transform2[2] + transform1[3] * transform2[3],
                transform1[0] * transform2[4] + transform1[2] * transform2[5] + transform1[4],
                transform1[1] * transform2[4] + transform1[3] * transform2[5] + transform1[5],
            ];
        },
    },
};

/**
 * 创建分页导航控件
 */
export function createPaginationControls(
    container: HTMLElement,
    currentPage: number,
    totalPages: number,
    onPageChange: (page: number) => void
): void {
    const nav = container.createDiv();
    nav.style.display = 'flex';
    nav.style.alignItems = 'center';
    nav.style.justifyContent = 'center';
    nav.style.gap = '12px';
    nav.style.padding = '12px';

    // 首页
    const firstBtn = nav.createEl('button', { text: '⏮' });
    firstBtn.disabled = currentPage <= 1;
    firstBtn.addEventListener('click', () => onPageChange(1));

    // 上一页
    const prevBtn = nav.createEl('button', { text: '◀' });
    prevBtn.disabled = currentPage <= 1;
    prevBtn.addEventListener('click', () => onPageChange(currentPage - 1));

    // 页码输入
    const pageInput = nav.createEl('input', {
        attr: {
            type: 'number',
            min: '1',
            max: String(totalPages),
            value: String(currentPage),
        },
    });
    pageInput.style.width = '60px';
    pageInput.style.textAlign = 'center';
    pageInput.addEventListener('change', () => {
        const page = parseInt(pageInput.value);
        if (page >= 1 && page <= totalPages) {
            onPageChange(page);
        }
    });

    nav.createEl('span', { text: `/ ${totalPages}` });

    // 下一页
    const nextBtn = nav.createEl('button', { text: '▶' });
    nextBtn.disabled = currentPage >= totalPages;
    nextBtn.addEventListener('click', () => onPageChange(currentPage + 1));

    // 末页
    const lastBtn = nav.createEl('button', { text: '⏭' });
    lastBtn.disabled = currentPage >= totalPages;
    lastBtn.addEventListener('click', () => onPageChange(totalPages));
}

/**
 * 创建缩放控件
 */
export function createZoomControls(
    container: HTMLElement,
    currentScale: number,
    onScaleChange: (scale: number) => void
): void {
    const zoomDiv = container.createDiv();
    zoomDiv.style.display = 'flex';
    zoomDiv.style.alignItems = 'center';
    zoomDiv.style.gap = '4px';

    const zoomOutBtn = zoomDiv.createEl('button', { text: '🔍−' });
    zoomOutBtn.addEventListener('click', () => {
        const newScale = Math.max(0.5, currentScale - 0.2);
        onScaleChange(newScale);
    });

    zoomDiv.createEl('span', {
        text: `${Math.round(currentScale * 100)}%`,
        attr: { style: 'min-width: 50px; text-align: center; font-size: 13px;' },
    });

    const zoomInBtn = zoomDiv.createEl('button', { text: '🔍+' });
    zoomInBtn.addEventListener('click', () => {
        const newScale = Math.min(3.0, currentScale + 0.2);
        onScaleChange(newScale);
    });

    const fitBtn = zoomDiv.createEl('button', { text: '📐' });
    fitBtn.addEventListener('click', () => onScaleChange(1.0));
}
