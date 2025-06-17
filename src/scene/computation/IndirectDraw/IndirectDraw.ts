import {SceneObject} from "../../sceneObject/sceneObject.ts";
import {createGPUBuffer} from "../../../helpers/global.helper.ts";
import {BaseLayer, RenderAble} from "../../../layers/baseLayer.ts";

export type LargeBuffer = {
    buffer?: GPUBuffer,
    needsUpdate: boolean;
    array: number[],
    version: number
}


export class IndirectDraw extends BaseLayer {
    private static indirectSceneObjects: Set<SceneObject> = new Set<SceneObject>();
    private static indexSceneObjects: Set<SceneObject> = new Set<SceneObject>();

    constructor(device: GPUDevice, canvas: HTMLCanvasElement, ctx: GPUCanvasContext) {
        super(device, canvas, ctx);

        BaseLayer.largeBufferMap.set("Indirect", {
            needsUpdate: false,
            array: [],
            version: 0
        })

        BaseLayer.largeBufferMap.set("Index", {
            needsUpdate: false,
            array: [],
            version: 0
        })
    }

    private static resizeBuffer(bufferType: "index" | "indirect") {
        const largeBuffer = bufferType === "index" ? BaseLayer.largeBufferMap.get("Index") as LargeBuffer : BaseLayer.largeBufferMap.get("Indirect") as LargeBuffer
        largeBuffer.buffer?.destroy();
        if (bufferType === "indirect") {
            largeBuffer.buffer = createGPUBuffer(BaseLayer.device, new Uint32Array(largeBuffer?.array as number[]), GPUBufferUsage.INDIRECT | GPUBufferUsage.STORAGE, `global indirect buffer`)
        } else {
            largeBuffer.buffer = createGPUBuffer(BaseLayer.device, new Uint32Array(largeBuffer?.array as number[]), GPUBufferUsage.INDEX, `global index buffer`)
        }
        largeBuffer.needsUpdate = false
        largeBuffer.version += 1
    }

    private static applyIndirectUpdate() {
        const indirect = BaseLayer.largeBufferMap.get("Indirect") as LargeBuffer
        indirect.array = []

        IndirectDraw.indirectSceneObjects.forEach(sceneObject => {
            sceneObject.primitives?.forEach((primitive) => {
                const positionCount = (sceneObject.primitivesData.get(primitive.id)?.dataList.get('POSITION')?.array.length as number) / 3;
                const dataArray = [primitive?.indexData?.length ?? positionCount, 1, 0, 0, 0];
                const startIndex = indirect.array.length;
                sceneObject.indirectBufferStartIndex.set(primitive.id, startIndex);
                indirect.array.push(...dataArray);
            });
        })
        indirect.needsUpdate = false
        IndirectDraw.resizeBuffer("indirect")
    }

    private static applyIndexUpdate() {
        const indexLargeBuffer = BaseLayer.largeBufferMap.get("Index") as LargeBuffer
        indexLargeBuffer.array = []

        IndirectDraw.indexSceneObjects.forEach(sceneObject => {
            sceneObject.primitives?.forEach((primitive) => {
                if (!primitive.indexData) throw new Error("indexData not found");

                const offset = indexLargeBuffer.array.length ?? 0;

                sceneObject.indexBufferStartIndex.set(primitive.id, offset);
                indexLargeBuffer.array.push(...primitive.indexData);
            });
        })

        indexLargeBuffer.needsUpdate = false
        IndirectDraw.resizeBuffer("index")
    }

    public renderLoop(renderAbleArray: RenderAble[], pass: GPURenderPassEncoder) {
        const indirect = BaseLayer.largeBufferMap.get("Indirect") as LargeBuffer
        const index = BaseLayer.largeBufferMap.get("Index") as LargeBuffer

        if (indirect.needsUpdate) IndirectDraw.applyIndirectUpdate()
        if (index.needsUpdate) IndirectDraw.applyIndexUpdate()

        renderAbleArray.forEach((item) => {
            pass.setPipeline(item.primitive.pipeline)
            item.primitive.bindGroups.forEach((group, i) => {
                pass.setBindGroup(i, group)
            })


            item.primitive.vertexBuffers.forEach((buffer, i) => {
                pass.setVertexBuffer(i, buffer)
            })

            const id = item.primitive.id;
            const sceneObj = item.sceneObject;

            const indirectOffset = sceneObj.indirectBufferStartIndex.get(id)! * 4;

            if (sceneObj.indexBufferStartIndex.has(id)) {
                const indexBufferStartIndex = sceneObj.indexBufferStartIndex.get(id);
                const indexBufferByteOffset = indexBufferStartIndex! * 4;
                pass.setIndexBuffer(index.buffer as GPUBuffer, "uint32", indexBufferByteOffset);

                pass.drawIndexedIndirect(indirect.buffer as GPUBuffer, indirectOffset);
            } else {
                pass.drawIndirect(indirect.buffer as GPUBuffer, indirectOffset);
            }
        })
    }

    public appendIndirect(sceneObject: SceneObject) {
        const indirect = BaseLayer.largeBufferMap.get("Indirect") as LargeBuffer
        IndirectDraw.indirectSceneObjects.add(sceneObject);
        indirect.needsUpdate = true
    }

    public appendIndex(sceneObject: SceneObject) {
        const index = BaseLayer.largeBufferMap.get("Index") as LargeBuffer
        IndirectDraw.indexSceneObjects.add(sceneObject);
        index.needsUpdate = true
    }
}