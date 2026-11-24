export const inactiveOrderStatuses=["cancelled","unassigned","expired","failed","no_cleaner"] as const;
export const completedOrderStatuses=["completed"] as const;
export const archivedOrderStatuses=[...completedOrderStatuses,...inactiveOrderStatuses];
export const cleanerHistoryStatuses=["pending_confirmation","disputed",...archivedOrderStatuses];
export const clientHistorySections=["active","archive","completed","cancelled"] as const;
export type ClientHistorySection=typeof clientHistorySections[number];
export function clientHistoryFilter(section:ClientHistorySection){
  switch(section){
    case "active": return {exclude:true,statuses:[...archivedOrderStatuses]};
    case "completed":return {exclude:false,statuses:[...completedOrderStatuses]};
    case "cancelled":return {exclude:false,statuses:[...inactiveOrderStatuses]};
    default:return {exclude:false,statuses:[...archivedOrderStatuses]};
  }
}
