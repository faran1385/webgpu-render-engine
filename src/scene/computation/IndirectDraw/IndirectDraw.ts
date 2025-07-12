import {SceneObject} from "../../sceneObject/sceneObject.ts";
import {createGPUBuffer} from "../../../helpers/global.helper.ts";
import {BaseLayer} from "../../../layers/baseLayer.ts";
import {Primitive} from "../../primitive/Primitive.ts";

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
            largeBuffer.buffer = createGPUBuffer(BaseLayer.device, new Uint32Array(largeBuffer?.array as number[]), GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_SRC | GPUBufferUsage.STORAGE, `global indirect buffer`)
        } else {
            largeBuffer.buffer = createGPUBuffer(BaseLayer.device, new Uint32Array(largeBuffer?.array as number[]), GPUBufferUsage.INDEX, `global index buffer`)
        }
        largeBuffer.needsUpdate = false
        largeBuffer.version += 1
    }

    private static applyIndirectUpdate() {
        const indirect = BaseLayer.largeBufferMap.get("Indirect") as LargeBuffer
        indirect.array = []
        IndirectDraw.indirectSceneObjects.forEach((sceneObject: SceneObject) => {
            sceneObject.primitives?.forEach((primitive) => {
                const positionCount = (primitive.geometry.dataList.get('POSITION')?.array.length as number) / 3;
                const dataArray = [primitive?.indexData?.length ?? positionCount, 1, 0, 0, 0];
                primitive.indirectBufferStartIndex = indirect.array.length
                for (let i = 0, len = dataArray.length; i < len; i++) {
                    indirect.array.push(dataArray[i]);
                }

            });
        })

        indirect.needsUpdate = false
        IndirectDraw.resizeBuffer("indirect")
    }

    private static applyIndexUpdate() {
        const indexLargeBuffer = BaseLayer.largeBufferMap.get("Index") as LargeBuffer
        indexLargeBuffer.array = []
        IndirectDraw.indexSceneObjects.forEach((sceneObject: SceneObject) => {
            sceneObject.primitives?.forEach((primitive) => {
                if (!primitive.indexData) throw new Error("indexData not found");

                primitive.indexBufferStartIndex = indexLargeBuffer.array.length ?? 0
                for (let i = 0, len = primitive.indexData.length; i < len; i++) {
                    indexLargeBuffer.array.push(primitive.indexData[i]);
                }
            });
        })
        indexLargeBuffer.needsUpdate = false
        IndirectDraw.resizeBuffer("index")
    }

    public renderLoop(primitives: Primitive[], pass: GPURenderPassEncoder) {
        const indirect = BaseLayer.largeBufferMap.get("Indirect") as LargeBuffer
        const index = BaseLayer.largeBufferMap.get("Index") as LargeBuffer

        if (indirect.needsUpdate) IndirectDraw.applyIndirectUpdate()
        if (index.needsUpdate) IndirectDraw.applyIndexUpdate()
        primitives.forEach((item) => {
            item.side.forEach((side) => {
                const pipeline = item.pipelines.get(side)!;

                pass.setPipeline(pipeline)
                pass.setBindGroup(0, IndirectDraw.globalBindGroup.bindGroup)
                item.bindGroups.forEach(({bindGroup, location}) => {
                    pass.setBindGroup(location, bindGroup)
                })
                item.vertexBuffers.forEach((buffer, i) => {


                    pass.setVertexBuffer(i, buffer)
                })
                const indirectOffset = item.indirectBufferStartIndex * 4;


                if (item.indirectBufferStartIndex !== undefined) {
                    const indexBufferByteOffset = item.indexBufferStartIndex! * 4;
                    pass.setIndexBuffer(index.buffer as GPUBuffer, "uint32", indexBufferByteOffset);

                    pass.drawIndexedIndirect(indirect.buffer as GPUBuffer, indirectOffset);
                } else {
                    pass.drawIndirect(indirect.buffer as GPUBuffer, indirectOffset);
                }
            })
        })
    }

    public appendIndirect(sceneObject: SceneObject) {
        const indirect = BaseLayer.largeBufferMap.get("Indirect") as LargeBuffer
        IndirectDraw.indirectSceneObjects.add(sceneObject);
        indirect.needsUpdate = true
    }

    public appendIndex(sceneObject: SceneObject) {
        const index = BaseLayer.largeBufferMap.get("Index") as LargeBuffer
        IndirectDraw.indexSceneObjects.add(sceneObject)
        index.needsUpdate = true
    }
}