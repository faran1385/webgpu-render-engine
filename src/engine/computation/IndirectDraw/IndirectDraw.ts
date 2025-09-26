import {SceneObject} from "../../sceneObject/sceneObject.ts";
import {createGPUBuffer} from "../../../helpers/global.helper.ts";
import {Primitive} from "../../primitive/Primitive.ts";
import {Scene} from "../../scene/Scene.ts";

export type LargeBuffer = {
    buffer?: GPUBuffer,
    needsUpdate: boolean;
    array: number[],
    version: number
}


export class IndirectDraw {
    private indirectSceneObjects: Set<SceneObject> = new Set<SceneObject>();
    private indexSceneObjects: Set<SceneObject> = new Set<SceneObject>();
    private scene: Scene

    constructor(scene: Scene) {
        this.scene = scene;

        this.scene.largeBufferMap.set("Indirect", {
            needsUpdate: false,
            array: [],
            version: 0
        })

        this.scene.largeBufferMap.set("Index", {
            needsUpdate: false,
            array: [],
            version: 0
        })
    }

    private resizeBuffer(bufferType: "Index" | "Indirect") {
        const largeBuffer = this.scene.largeBufferMap.get(bufferType)!
        largeBuffer.buffer?.destroy();

        if (bufferType === "Indirect") {
            largeBuffer.buffer = createGPUBuffer(this.scene.device, new Uint32Array(largeBuffer?.array!), GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_SRC | GPUBufferUsage.STORAGE, `global indirect buffer`)
        } else {
            largeBuffer.buffer = createGPUBuffer(this.scene.device, new Uint32Array(largeBuffer?.array!), GPUBufferUsage.INDEX, `global index buffer`)
        }
        largeBuffer.needsUpdate = false
        largeBuffer.version += 1
    }

    public applyIndirectUpdate() {
        const indirect = this.scene.largeBufferMap.get("Indirect") as LargeBuffer
        indirect.array = []
        this.indirectSceneObjects.forEach((sceneObject: SceneObject) => {
            sceneObject.primitives?.forEach((primitive) => {
                const positionCount = (primitive.geometry.dataList.get('POSITION')?.array.length!) / 3;

                const dataArray = [primitive?.indexData?.length ?? positionCount, 1, 0, 0, 0];
                primitive.indirectBufferStartIndex = indirect.array.length
                for (let i = 0, len = dataArray.length; i < len; i++) {
                    indirect.array.push(dataArray[i]);
                }

            });
        })

        indirect.needsUpdate = false
        this.resizeBuffer("Indirect")
    }

    public applyIndexUpdate() {
        const indexLargeBuffer = this.scene.largeBufferMap.get("Index") as LargeBuffer
        indexLargeBuffer.array = []
        this.indexSceneObjects.forEach((sceneObject: SceneObject) => {
            sceneObject.primitives?.forEach((primitive) => {
                if (!primitive.indexData) throw new Error("indexData not found");

                primitive.indexBufferStartIndex = indexLargeBuffer.array.length ?? 0
                for (let i = 0, len = primitive.indexData.length; i < len; i++) {
                    indexLargeBuffer.array.push(primitive.indexData[i]);
                }
            });
        })

        indexLargeBuffer.needsUpdate = false
        this.resizeBuffer("Index")
    }

    removeIndirect() {
        this.indirectSceneObjects.clear();
        this.indexSceneObjects.clear();
        const indirect = this.scene.largeBufferMap.get("Indirect")!
        indirect.buffer?.destroy()
        indirect.array = [];
        indirect.version = 0;
        indirect.needsUpdate = true

        const indices = this.scene.largeBufferMap.get("Index")!
        indices.buffer?.destroy()
        indices.array = [];
        indices.version = 0;
        indices.needsUpdate = true
    }

    public renderLoop(primitives: Primitive[], environment: Primitive, pass: GPURenderPassEncoder) {
        const indirect = this.scene.largeBufferMap.get("Indirect") as LargeBuffer
        const index = this.scene.largeBufferMap.get("Index") as LargeBuffer

        if (environment) {
            environment.sides.forEach((side) => {
                const pipeline = environment.pipelines.get(side);
                if (!pipeline) throw new Error("pipeline not found");
                pass.setPipeline(pipeline)
                pass.setBindGroup(0, this.scene.usedGlobalBindGroup)
                pass.setBindGroup(1, environment.material.bindGroup)
                pass.setBindGroup(2, environment.geometry.bindGroup)

                environment.vertexBuffers.forEach((buffer, i) => {
                    pass.setVertexBuffer(i, buffer)
                })
                const indirectOffset = environment.indirectBufferStartIndex * 4;

                if (environment.indexBufferStartIndex !== undefined) {
                    const indexBufferByteOffset = environment.indexBufferStartIndex! * 4;
                    pass.setIndexBuffer(index.buffer as GPUBuffer, "uint32", indexBufferByteOffset);
                    pass.drawIndexedIndirect(indirect.buffer as GPUBuffer, indirectOffset);
                } else {
                    pass.drawIndirect(indirect.buffer as GPUBuffer, indirectOffset);
                }
            })

        }
        primitives.forEach((item) => {
            item.sides.forEach((side) => {
                const pipeline = item.pipelines.get(side)!;
                pass.setPipeline(pipeline)
                pass.setBindGroup(0, this.scene.usedGlobalBindGroup)
                pass.setBindGroup(1, item.material.bindGroup)
                pass.setBindGroup(2, item.geometry.bindGroup)
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
        const indirect = this.scene.largeBufferMap.get("Indirect") as LargeBuffer
        this.indirectSceneObjects.add(sceneObject);
        indirect.needsUpdate = true
    }

    public appendIndex(sceneObject: SceneObject) {
        const index = this.scene.largeBufferMap.get("Index") as LargeBuffer
        this.indexSceneObjects.add(sceneObject)
        index.needsUpdate = true
    }

    public deleteIndirect(sceneObject: SceneObject) {
        const indirect = this.scene.largeBufferMap.get("Indirect") as LargeBuffer
        this.indirectSceneObjects.delete(sceneObject);
        indirect.needsUpdate = true
    }

    public deleteIndex(sceneObject: SceneObject) {
        const index = this.scene.largeBufferMap.get("Index") as LargeBuffer
        this.indexSceneObjects.delete(sceneObject)
        index.needsUpdate = true
    }
}