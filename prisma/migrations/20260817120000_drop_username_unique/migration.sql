-- Le pseudo public n'est pas unique (contrairement à l'email) : plusieurs
-- comptes peuvent partager le même username.
DROP INDEX "User_username_key";
