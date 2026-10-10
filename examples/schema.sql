-- Development demo schema. Run against an isolated SQL Server database.
CREATE TABLE dbo.Customers
(
    Id int NOT NULL PRIMARY KEY,
    FirstName nvarchar(120) NOT NULL,
    Age int NOT NULL,
    IsActive bit NOT NULL
);
GO
CREATE TABLE dbo.Orders
(
    Id int NOT NULL PRIMARY KEY,
    CustomerId int NOT NULL REFERENCES dbo.Customers(Id),
    Total decimal(18, 2) NOT NULL,
    Status nvarchar(40) NOT NULL
);
GO
INSERT INTO dbo.Customers (Id, FirstName, Age, IsActive) VALUES
(1, N'John', 27, 1),
(2, N'John', 16, 0),
(3, N'Alice', 34, 1),
(4, N'John', 17, 1);
INSERT INTO dbo.Orders (Id, CustomerId, Total, Status) VALUES
(1, 1, 160.00, N'Completed'),
(2, 1, 25.00, N'Pending'),
(3, 2, 15.00, N'Pending'),
(4, 3, 250.00, N'Completed'),
(5, 4, 120.00, N'Completed');
GO
-- Use a dedicated read-only login in any real deployment.
