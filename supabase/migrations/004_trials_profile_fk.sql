alter table public.trials add constraint trials_user_profile_fk foreign key (user_id) references public.profiles (id) on delete cascade;
