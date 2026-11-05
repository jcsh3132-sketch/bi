export class SettlementPending extends Error {
 constructor(){super('거래 종료 정산을 확인 중입니다. 정산 완료 후 다음 신호를 자동으로 확인합니다.');this.name='SettlementPending';}
}
