insert into users(id,pw,name,dept,role,status) values ('admin','adminpw','최고관리자','본사','admin','active'),('mgr','mgrpw','부관리자','본사','admin','active'),('u1','pw1','김현장','설치','user','active'),('u2','pw2','이현장','스토어','user','active'),('off','pwoff','비활성','본사','user','inactive');
insert into groups(id,name) values ('g1','설치법인'),('g2','스토어');
insert into group_members values ('g1','u1'),('g2','u2');
