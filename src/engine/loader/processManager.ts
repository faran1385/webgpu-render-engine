export class ProcessManager {
    private count: number;
    private downloadPercentageArray: number[]

    private userProcessFunc: (totalPercentage: number) => void

    totalPercentage: number = 0

    constructor(downloadManageCount: number, process: (totalPercentage: number) => void) {
        this.count = downloadManageCount;
        this.downloadPercentageArray = new Array(downloadManageCount).fill(0);
        this.userProcessFunc = process
    }

    updateIndex(index: number, P: number) {
        this.downloadPercentageArray[index] = P;
        this.setTotalPercentage();
        this.userProcessFunc(this.totalPercentage)
    }

    private setTotalPercentage() {
        let total = 0;

        this.downloadPercentageArray.forEach(item => {
            total += item;
        })

        this.totalPercentage = total / this.count;
    }

    reset() {
        this.downloadPercentageArray = new Array(this.count).fill(0);
    }
}