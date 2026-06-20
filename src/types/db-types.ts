export interface MenuItem {
  id: string;
  name: string;
  description: string;
}

export interface Drop {
  id: string;
  name: string;
  openTime: string;
  closeTime: string;
  showCountdown: boolean;
}

export interface DropItem {
  dropId: string;
  menuItemId: string;
  initialStock: number;
  consumedStock: number;
  preview: boolean;
  tag: string;
}

// A drop item joined with its menu item, ready for display.
export interface DropItemWithMenu {
  menuItem: MenuItem;
  initialStock: number;
  consumedStock: number;
  preview: boolean;
  tag: string;
}