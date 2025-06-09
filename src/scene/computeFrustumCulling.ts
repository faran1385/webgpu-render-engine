import {LODRange, MeshData} from "./loader/loaderTypes.ts";

type taskQueueItem = {
    task: {
        lodRanges: LODRange[] | undefined
        position: Float32Array<ArrayBufferLike>
    }[],
    func: (T: {
        min: [number, number, number],
        max: [number, number, number],
    }) => void
    modelMatrix: Float32Array,
}


export class ComputeFrustumCulling {
    private readonly workers: { worker: Worker, busy: boolean }[] = [];
    private readonly onProcessTaskQueue: Map<number, taskQueueItem> = new Map();
    private readonly idleTaskQueue: Map<number, taskQueueItem> = new Map();

    constructor() {
        const numWorkers = Math.min(navigator.hardwareConcurrency || 4, 8);
        if (this.constructor === ComputeFrustumCulling) {
            this.initialize(numWorkers)
        }
    }

    private initialize(numWorkers: number) {
        const workerCode = `

        /**
         * Compute the local (object-space) AABB.
         * @param {Float32Array|number[]} verts – flat [x,y,z,x,y,z,…]
         * @returns {{min: [number,number,number], max: [number,number,number]}}
         */
        function computeLocalAABB(verts) {
          let minX =  Infinity, minY =  Infinity, minZ =  Infinity;
          let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        
          for (let i = 0; i < verts.length; i += 3) {
            const x = verts[i],   y = verts[i+1],   z = verts[i+2];
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (z < minZ) minZ = z;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
            if (z > maxZ) maxZ = z;
          }
        
          return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
        }
        
        /**
         * Transform an AABB by a 4×4 matrix.  
         * Assumes column-major order: m[0]=m00, m[1]=m01, …, m[12]=m30, …, m[15]=m33.
         * @param {[number,number,number]} min – local AABB min corner
         * @param {[number,number,number]} max – local AABB max corner
         * @param {number[]} m – length-16 modelMatrix
         */
        function transformAABB(min, max, m) {
          // Generate the 8 corners of the local AABB:
          const corners = [
            [min[0], min[1], min[2]],
            [min[0], min[1], max[2]],
            [min[0], max[1], min[2]],
            [min[0], max[1], max[2]],
            [max[0], min[1], min[2]],
            [max[0], min[1], max[2]],
            [max[0], max[1], min[2]],
            [max[0], max[1], max[2]],
          ];
        
          // Helper to transform a point by m:
          function transformPoint([x, y, z]) {
            return [
              m[0]*x + m[4]*y + m[8]*z  + m[12],
              m[1]*x + m[5]*y + m[9]*z  + m[13],
              m[2]*x + m[6]*y + m[10]*z + m[14],
            ];
          }
        
          // Initialize world-space min/max:
          let wminX =  Infinity, wminY =  Infinity, wminZ =  Infinity;
          let wmaxX = -Infinity, wmaxY = -Infinity, wmaxZ = -Infinity;
        
          // Transform each corner, fold into world-min/max
          for (let i = 0; i < 8; i++) {
            const [tx, ty, tz] = transformPoint(corners[i]);
            if (tx < wminX) wminX = tx;
            if (ty < wminY) wminY = ty;
            if (tz < wminZ) wminZ = tz;
            if (tx > wmaxX) wmaxX = tx;
            if (ty > wmaxY) wmaxY = ty;
            if (tz > wmaxZ) wmaxZ = tz;
          }
        
          return { min: [wminX, wminY, wminZ], max: [wmaxX, wmaxY, wmaxZ] };
        }
        
        /**
         * Full pipeline: compute and transform AABB.
         * @param {Float32Array|number[]} verts
         * @param {number[]} modelMatrix
         */
        function computeWorldAABB(verts, modelMatrix) {
          const { min, max } = computeLocalAABB(verts);
          return transformAABB(min, max, modelMatrix);
        }


        self.onmessage=(e)=>{
            
            const vertices = e.data.geometry.map((prim) => {
                  const array = prim.lodRanges
                    ? prim.position?.slice(
                        prim.lodRanges[0].start,
                        prim.lodRanges[0].start + prim.lodRanges[0].count
                      )
                    : prim.vertex.position?.array;
            
                  return array ? Array.from(array) : [];
                }).flat();
            
            self.postMessage({...computeWorldAABB(vertices,e.data.modelMatrix),taskId:e.data.taskId});
        }
        `


        for (let i = 0; i < numWorkers; i++) {
            const blob = new Blob([workerCode], {type: "application/javascript"})
            const worker = new Worker(URL.createObjectURL(blob))
            this.workers.push({
                worker,
                busy: false
            })
        }

    }

    public appendToQueue(mesh: MeshData, func: (T: {
        min: [number, number, number],
        max: [number, number, number],
    }) => void, modelMatrix: Float32Array) {
        const task = mesh.geometry.map(item => {
            return {
                lodRanges: item.lodRanges,
                position: item.dataList['POSITION'].array
            }
        })

        this.idleTaskQueue.set(Math.random(), {
            task,
            func,
            modelMatrix,
        })
        this.findNonBusyWorker()
    }

    private assignWork(index: number) {

        const queueItem = this.idleTaskQueue.entries().next().value;
        if (queueItem) {
            this.workers[index].busy = true;
            this.workers[index].worker.postMessage({
                geometry: queueItem[1].task,
                modelMatrix: queueItem[1].modelMatrix,
                taskId: queueItem[0],
            })
            this.onProcessTaskQueue.set(queueItem[0], queueItem[1])
            this.idleTaskQueue.delete(queueItem[0])
        } else {
            this.workers[index].busy = false;
        }
    }

    private findNonBusyWorker() {
        const index = this.workers.findIndex((worker) => !worker.busy)
        if (index !== -1) {
            this.assignWork(index)
            this.workers[index].worker.onmessage = (e) => {
                this.assignWork(index)
                const queueItem = this.onProcessTaskQueue.get(e.data.taskId)
                if (queueItem) {
                    queueItem.func(e.data)
                    this.onProcessTaskQueue.delete(e.data.taskId)
                }
            }
        }
    }

}
