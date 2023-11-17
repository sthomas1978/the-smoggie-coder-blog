---
title: Bulk Upsert To SQL Server
description: Exploring a way to bulk upsert into SQL Server using Table Valued Parameters
date: "2023-02-07T23:46:37.121Z"
keywords: "sql server, bulk insert, import, c#, dotnet, performance, table valued parameters"
---

### Background

In my previous post I talked about different strategies for bulk inserting data into SQL Server. One of these strategies was using a technique of insering the data using tabled valued parameters (TVP). What I alluded to was how this was done, well this post will explain it.

#### First Implementation

A TVP acts like a an array whereby you can passed your type to the sql statement. You do this by first defining a SQL type.

So for example if I have c# Person class

```csharp
public class Person
{
    public int Id { get; set; }
    public string FirstName { get; set; }
    public string LastName { get; set; }
    public DateTime DateOfBirth { get; set; }
    public string JobTitle { get; set; }
    public decimal Salary { get; set; }
    public bool IsMarried { get; set; }
}
```

the equivalent SQL type would be

```sql
CREATE TYPE [dbo].[PersonType] AS TABLE(
	[Id] [int] NOT NULL,
	[FirstName] [nvarchar](255) NOT NULL,
	[LastName] [nvarchar](255) NOT NULL,
	[DateOfBirth] [datetime2](7) NOT NULL,
	[JobTitle] [nvarchar](255) NOT NULL,
	[Salary] [decimal](18, 7) NOT NULL,
	[IsMarried] [bit] NOT NULL
)
```

In order to bulk insert into the database you would write something like this for your insert statement where data is `IEnumerable<Person>`

```csharp
if (connection.State == ConnectionState.Closed) { connection.Open(); }

var command = new SqlCommand(BuildInsertStatement(), connection);

var param = command.Parameters.AddWithValue("@tvpPersons", data);
param.SqlDbType = SqlDbType.Structured;
param.TypeName = "PersonType";

connection.Open();
command.ExecuteNonQuery();
connection.Close();

```

whereby `BuildInsertStatement` would look like

```csharp
string BuildInsertStatement() => @"
INSERT INTO dbo.Persons(
  [FirstName],
	[LastName],
	[DateOfBirth],
	[JobTitle] ,
	[Salary],
	[IsMarried])
SELECT 
    [FirstName], [LastName], [DateOfBirth], 
    [JobTitle], [Salary], [IsMarried]
FROM @tvpPersons
";
```

This is a good start and is very performant as demonstrated in the previous post. But there are a couple of improvements we can do to make this more flexible

- We can make the routine accept any type.
- We could convert the insert operation into an upsert operation.
- We could update the newly created entities with the generated ids from the insert operation

#### Making The Routine Accept Any Type

To make th routine accept any type we employ reflection to interrogate the type and build the necessary SQL to run the routine.

```csharp
        public string BuildUserDefinedTypeSql(params string[] exclusions)
        {
            var type = typeof(T);
            var properties = _properties.Where(p => !exclusions.Any(e => e == p.Name));

            return $"""
DROP TYPE IF EXISTS dbo.{type.Name}Type;
CREATE TYPE [dbo].{type.Name}Type AS TABLE (
{string.Join($",{Environment.NewLine}", properties.Select(p => $"    [{p.Name}] {ConvertToDbType(p.PropertyType)} NOT NULL"))},
    TempId INT
)
"""
            ;
        }

```

We use reflection to query the metadata about the properties and generate the SQL statement to create the SQL Type. We initially perform a drop operation first to clear out any stale existing SQL Types and then perform the create operation. If you notice as part of the create type operation we append and additional column called TempId, this is key for the last bit.

#### Convert The Insert Operation To An Upsert Operation

To generate an upsert operation I utilise SQL Server [MERGE Operation](https://learn.microsoft.com/en-us/sql/t-sql/statements/merge-transact-sql?view=sql-server-ver16) which is pretty useful as it lets you perform updates and inserts in one go.

```csharp
        public string BuildUpsertStatementSql()
        {
            var type = typeof(T);

            var propertiesWithoutKey = _properties.Where(p => !Attribute.IsDefined(p, typeof(KeyAttribute))).ToArray();
            var propertiesWithKey = _properties.Where(p => Attribute.IsDefined(p, typeof(KeyAttribute))).ToArray();

            return $"""
DECLARE @Output TABLE (
    [Action] NVARCHAR(20),
	[Id] INT,
	[TempId] INT
);
MERGE dbo.{type.Name}s as target
USING (
    SELECT { string.Join(", ", _properties.Select(p => p.Name)) }, TempId
    FROM @tvpData
    ) AS source({string.Join(", ", _properties.Select(p => p.Name))}, TempId)
ON {string.Join(" AND ", propertiesWithKey.Select(p => $"target.{p.Name} = source.{p.Name}"))}

WHEN MATCHED THEN 
UPDATE SET 
{string.Join($",{Environment.NewLine}", propertiesWithoutKey.Select(p => $"    target.{p.Name} = source.{p.Name}"))}

WHEN NOT MATCHED BY TARGET THEN
    INSERT({string.Join(", ", propertiesWithoutKey.Select(p => p.Name))})
    VALUES({string.Join(", ", propertiesWithoutKey.Select(p => p.Name))})

OUTPUT $action Action, Inserted.Id [Id], Source.TempId [TempId] INTO @Output;

SELECT [Action], [Id], [TempId]
FROM @Output WHERE Action = 'INSERT'
""";
        }

```

#### Return The Ids Of Newly Inserted Entities

When the merge operation is executed it returns the ids of the newly inserted records. The problem here is how to do we map these new Ids to the correct domain object? 

Before we send the domain objects to SQL Server, we create a `Dictionary<int, T> map`. The key will be an arbitary temporary id when we populate the dictionary

```csharp
var map = new Dictionary<int, T>(
	items.Select((item, idx) => new KeyValuePair<int, T>(idx, item)));
```

When we upload the records for an upsert operation we attach the temporary id to the record, we return any newly inserted records with its newid mapped to the temporary id as per `OUTPUT $action Action, Inserted.Id [Id], Source.TempId [TempId] INTO @Output;`.

We then iterate over the returned results and set the the newly generated id of new domain objects using the following

```csharp
while (results.Read())
{
	var item = map[results.GetInt32("TempId")];
  keys.ForEach(p => p.SetValue(item, results.GetInt32(p.Name)));
}
```

#### Summary

This strategy is flexible way of performing bulk upsert operations using TVP, one improvement we could make is rather than use reflection for dynamic discovery at runtime, we could use source generators to generate code and compile it.
