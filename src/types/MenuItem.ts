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