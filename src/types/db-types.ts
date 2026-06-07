export interface MenuItem {
  id: string;
  mystery: boolean;
  name: string;
  description: string;
}

export interface SpecialMenuItem {
  menuItem: MenuItem;
  tag: string;
}

export interface Drop {
  id: string;
  name: string;
  openTime: string;
  closeTime: string;
}

export interface DropItem {
  dropId: string;
  menuItemId: string;
  initialStock: number;
  consumedStock: number;
}