export interface DomoUser {
  id: number;
  displayName: string;
  userName: string;
  roleId: number;
  emailAddress: string;
  attributes: DomoUserAttribute[];
}

export interface DomoUserAttribute {
  key: string;
  values: (number | string)[];
}

export interface DomoGroup {
  id: number;
  name: string;
  type: string;
  userIds: number[];
  creatorId: number;
  memberCount: number;
  guid: string;
  description: string;
  hidden: boolean;
  default: boolean;
}
